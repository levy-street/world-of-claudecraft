// The five-player dungeon boss guides (src/ui/boss_journal/): every page is
// complete, localized, and true to the sim it describes. The generic block
// runs over EVERY registered dungeon journal, so a new dungeon page is covered
// the moment it joins the registry; the per-dungeon blocks pin the facts the
// audit found players misread.

import { describe, expect, it } from 'vitest';
import { decodeDungeonRun } from '../src/net/dungeon_run_wire';
import { mobVisualKey, VISUALS } from '../src/render/characters/manifest';
import { SANCTUM_CAST_SPECS } from '../src/render/gravewyrm_sanctum_bosses/boss_fx_core';
import { sanctumTelegraphSpecs } from '../src/render/gravewyrm_sanctum_fx/sanctum_fx_core';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { finderActivity } from '../src/sim/content/dungeon_finder';
import { MOBS } from '../src/sim/data';
import {
  hydraRegrowShare,
  SELTHE_TUNING,
  YSOLEI_MOON_TUNING,
} from '../src/sim/encounters/drowned_temple/ids';
import {
  KORGATH_BODY,
  KORGATH_CHAIN_FLAIL,
  KORGATH_THRESHOLD_CHARGE,
  KORGATH_TUNING,
  KORZUL_TUNING,
  TUSKER_TRAMPLE,
  TUSKER_TUNING,
} from '../src/sim/encounters/gravewyrm_sanctum/ids';
import { embraceBreakShare, LADY_TUNING } from '../src/sim/encounters/hollow_crypt/lady_ids';
import { tollDamageRange } from '../src/sim/encounters/hollow_crypt/marrow_ids';
import { MORTHEN_TUNING } from '../src/sim/encounters/hollow_crypt/morthen_ids';
import { OLEN_KIT } from '../src/sim/encounters/sunken_bastion/ids';
import { BEAST_TUNING, ZULGAR_TUNING } from '../src/sim/encounters/wildheart_basin/ids';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { journalModelFor } from '../src/ui/boss_journal/journal_model_spec';
import { formattedJournalValues } from '../src/ui/boss_journal/journal_sections';
import { mechanicFactor } from '../src/ui/boss_journal/journal_tuning';
import {
  dungeonJournalBossView,
  type JournalDifficulty,
  journalContextFor,
  nextJournalBoss,
  RAID_JOURNAL_SOURCE,
} from '../src/ui/boss_journal/journal_view';
import { DUNGEON_JOURNALS, dungeonJournalSourceFor } from '../src/ui/boss_journal/registry';
import { hasTranslation, type TranslationKey, t } from '../src/ui/i18n';
import { hasExplicitAbilityIcon } from '../src/ui/icons';

const TIERS: readonly JournalDifficulty[] = ['normal', 'heroic'];
const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/;
const DASHES = /[\u2013\u2014]/;

function rendered(
  key: TranslationKey,
  values?: Readonly<Record<string, number>>,
  percent?: readonly string[],
) {
  return t(key, formattedJournalValues(values, percent));
}

function expectText(
  label: string,
  key: TranslationKey,
  values?: Readonly<Record<string, number>>,
  percent?: readonly string[],
) {
  expect(hasTranslation(key, 'en'), `${label}: missing catalog key ${key}`).toBe(true);
  const text = rendered(key, values, percent);
  expect(text, `${label}: ${key} leaves a placeholder unfilled`).not.toMatch(PLACEHOLDER);
  expect(text, `${label}: ${key} carries an en or em dash`).not.toMatch(DASHES);
  expect(text.trim().length, `${label}: ${key} is empty`).toBeGreaterThan(0);
}

describe.each(DUNGEON_JOURNALS.map((def) => [def.dungeonId, def] as const))(
  'dungeon journal %s',
  (dungeonId, def) => {
    it('lists every Dungeon Finder boss of both tiers, in route order', () => {
      const keys = def.bosses.map((boss) => boss.mobId);
      for (const tier of TIERS) {
        const activity = finderActivity(`${dungeonId}_${tier}`);
        expect(activity, `${dungeonId}_${tier} finder row`).not.toBeNull();
        const finderBosses = activity?.encounters.map((e) => e.mobId) ?? [];
        for (const mobId of finderBosses) expect(keys).toContain(mobId);
        const order = finderBosses.map((mobId) => keys.indexOf(mobId));
        expect(order).toEqual([...order].sort((a, b) => a - b));
      }
      for (const boss of def.bosses) expect(MOBS[boss.mobId], boss.mobId).toBeDefined();
      expect(def.bosses.filter((boss) => boss.rank === 'final')).toHaveLength(1);
    });

    it('resolves every line on both tiers with no missing key or placeholder', () => {
      for (const boss of def.bosses) {
        for (const tier of TIERS) {
          const view = dungeonJournalBossView(boss, tier);
          const label = `${boss.mobId} ${tier}`;
          expectText(label, view.overviewKey, view.overviewValues, view.overviewPercentValues);
          expect(view.phases.length).toBeGreaterThan(0);
          for (const phase of view.phases) {
            expectText(label, phase.nameKey);
            expectText(label, phase.summaryKey, phase.values, phase.percentValues);
            for (const m of phase.mechanics) {
              expectText(`${label} ${m.id}`, m.nameKey, m.values, m.percentValues);
              expectText(`${label} ${m.id}`, m.summaryKey, m.values, m.percentValues);
              expectText(`${label} ${m.id}`, m.responseKey, m.values, m.percentValues);
              expect(m.roles.length, `${m.id} roles`).toBeGreaterThan(0);
              expect(hasExplicitAbilityIcon(m.iconId), `${m.iconId} recipe`).toBe(true);
            }
          }
          expect(view.tips?.map((tip) => tip.role)).toEqual(['tank', 'healer', 'damage']);
          for (const tip of view.tips ?? []) {
            expectText(label, tip.key, tip.values, tip.percentValues);
          }
          for (const choice of view.choices ?? []) {
            expectText(label, choice.nameKey, choice.values, choice.percentValues);
            expectText(label, choice.gainKey, choice.values, choice.percentValues);
            expectText(label, choice.riskKey, choice.values, choice.percentValues);
            expect(hasExplicitAbilityIcon(choice.iconId)).toBe(true);
          }
          for (const note of view.heroicNotes ?? []) {
            expectText(label, note.key, note.values, note.percentValues);
          }
          expect((view.heroicNotes ?? []).length > 0).toBe(tier === 'heroic');
        }
      }
    });

    it('names every cast-bar mechanic exactly as its cast bar, and flags kicks truthfully', () => {
      for (const boss of def.bosses) {
        for (const phase of boss.phases) {
          for (const m of phase.mechanics) {
            if (m.castId) {
              const castKey = `abilityUi.cast.${m.castId}` as TranslationKey;
              expect(hasTranslation(castKey, 'en'), castKey).toBe(true);
              expect(m.nameKey, `${m.id} must read its cast bar name`).toBe(castKey);
              const kickable = Object.hasOwn(SCRIPTED_INTERRUPTIBLE_CHANNELS, m.castId);
              expect(m.flags?.includes('interruptible') ?? false, `${m.id} interruptible`).toBe(
                kickable,
              );
            } else {
              expect(
                m.flags?.includes('interruptible') ?? false,
                `${m.id} has no kickable bar`,
              ).toBe(false);
            }
          }
        }
      }
    });

    it('hides heroic-only mechanics on Normal and marks every tier difference on Heroic', () => {
      for (const boss of def.bosses) {
        const normal = dungeonJournalBossView(boss, 'normal');
        const heroic = dungeonJournalBossView(boss, 'heroic');
        const normalIds = normal.phases.flatMap((p) => p.mechanics.map((m) => m.id));
        const heroicMechanics = heroic.phases.flatMap((p) => p.mechanics);
        for (const phase of boss.phases) {
          for (const m of phase.mechanics) {
            const shown = heroicMechanics.find((h) => h.id === m.id);
            expect(shown, `${m.id} on heroic`).toBeDefined();
            if (m.availability === 'heroic') {
              expect(normalIds).not.toContain(m.id);
              expect(shown?.marks).toEqual(['heroicOnly']);
            } else {
              expect(normalIds).toContain(m.id);
            }
          }
        }
        for (const m of normal.phases.flatMap((p) => p.mechanics)) expect(m.marks).toBeUndefined();
      }
    });

    it('uses the boss real in-game model whenever the guide can build it', () => {
      for (const boss of def.bosses) {
        const model = journalModelFor(boss.mobId);
        const visual = VISUALS[mobVisualKey(boss.mobId)];
        if (!model) {
          expect(visual?.bodyless || visual?.wocCharacter || visual?.modular).toBeTruthy();
          continue;
        }
        expect(model.spec.url).toBe(visual?.url);
        expect(model.spec.height).toBe(visual?.height);
        expect(model.spec.idle).toBe(visual?.clips.idle ?? null);
      }
    });
  },
);

describe('journal room context', () => {
  it('keeps the raid rooms on the raid source and offers each dungeon its own page', () => {
    expect(journalContextFor('nythraxis_boss_arena', null, dungeonJournalSourceFor)?.source).toBe(
      RAID_JOURNAL_SOURCE,
    );
    expect(journalContextFor('some_meadow', null, dungeonJournalSourceFor)).toBeNull();
    expect(journalContextFor(null, null, dungeonJournalSourceFor)).toBeNull();
    for (const def of DUNGEON_JOURNALS) {
      const ctx = journalContextFor(def.dungeonId, null, dungeonJournalSourceFor);
      expect(ctx?.source.id).toBe(def.dungeonId);
      expect(ctx?.bossKey).toBe(def.bosses[0].mobId);
      expect(ctx?.runDifficulty).toBeNull();
    }
  });

  it('suggests the next standing boss and the run difficulty', () => {
    const run = {
      dungeonId: 'gravewyrm_sanctum',
      difficulty: 'heroic' as const,
      bosses: [
        { mobId: 'korgath_the_bound', defeated: true },
        { mobId: 'grand_necromancer_velkhar', defeated: false },
        { mobId: 'korzul_the_gravewyrm', defeated: false },
      ],
    };
    const ctx = journalContextFor('gravewyrm_sanctum', run, dungeonJournalSourceFor);
    expect(ctx?.bossKey).toBe('grand_necromancer_velkhar');
    expect(ctx?.runDifficulty).toBe('heroic');
    // The untracked miniboss before a defeated boss counts as passed; before
    // any defeat it is the first suggestion.
    const keys = ['sledge_tusker', 'korgath_the_bound', 'grand_necromancer_velkhar'];
    expect(nextJournalBoss(keys, run)).toBe('grand_necromancer_velkhar');
    expect(
      nextJournalBoss(keys, {
        ...run,
        bosses: run.bosses.map((b) => ({ ...b, defeated: false })),
      }),
    ).toBe('sledge_tusker');
  });
});

describe('journal room context on the online mirror', () => {
  it('reads a ClientWorld-decoded run exactly like the offline Sim view', () => {
    const wire = decodeDungeonRun({
      dungeonId: 'gravewyrm_sanctum',
      difficulty: 'heroic',
      bosses: [
        { mobId: 'korgath_the_bound', defeated: true },
        { mobId: 'grand_necromancer_velkhar', defeated: false },
        { mobId: 'korzul_the_gravewyrm', defeated: false },
      ],
    });
    expect(wire).not.toBeNull();
    const ctx = journalContextFor('gravewyrm_sanctum', wire, dungeonJournalSourceFor);
    expect(ctx?.bossKey).toBe('grand_necromancer_velkhar');
    expect(ctx?.runDifficulty).toBe('heroic');
    expect(
      journalContextFor('gravewyrm_sanctum', decodeDungeonRun(null), dungeonJournalSourceFor)
        ?.bossKey,
    ).toBe('sledge_tusker');
  });
});

describe('Gravewyrm Sanctum facts', () => {
  const def = DUNGEON_JOURNALS.find((d) => d.dungeonId === 'gravewyrm_sanctum');
  if (!def) throw new Error('sanctum journal missing');
  const boss = (mobId: string) => {
    const found = def.bosses.find((b) => b.mobId === mobId);
    if (!found) throw new Error(mobId);
    return found;
  };
  const mechanic = (mobId: string, id: string, tier: JournalDifficulty) => {
    const found = dungeonJournalBossView(boss(mobId), tier)
      .phases.flatMap((p) => p.mechanics)
      .find((m) => m.id === id);
    if (!found) throw new Error(`${mobId} ${id} ${tier}`);
    return found;
  };

  it('runs the route Tusker, Korgath, Velkhar, Korzul', () => {
    expect(def.bosses.map((b) => [b.mobId, b.rank])).toEqual([
      ['sledge_tusker', 'miniboss'],
      ['korgath_the_bound', 'boss'],
      ['grand_necromancer_velkhar', 'boss'],
      ['korzul_the_gravewyrm', 'final'],
    ]);
  });

  it('explains the chains: 20 percent per intact chain, 80 with all four, one attack per break', () => {
    const lock = mechanic('korgath_the_bound', 'lockbound', 'normal');
    expect(lock.values?.perChain).toBe(KORGATH_TUNING.lockboundPerChain);
    expect(lock.values?.all).toBeCloseTo(KORGATH_TUNING.lockboundPerChain * 4);
    expect(rendered(lock.summaryKey, lock.values, lock.percentValues)).toContain('20%');
    expect(rendered(lock.summaryKey, lock.values, lock.percentValues)).toContain('80%');
    const korgath = dungeonJournalBossView(boss('korgath_the_bound'), 'normal');
    const choice = korgath.choices?.[0];
    if (!choice) throw new Error('Korgath has no choice');
    const risk = rendered(choice.riskKey, choice.values, choice.percentValues);
    for (const cast of ['Maul Arc', 'Chain Flail', 'Threshold Charge', "Foreman's Bellow"]) {
      expect(risk).toContain(cast);
    }
    const freed = korgath.phases.find((p) => p.id === 'freed')?.mechanics.map((m) => m.id);
    expect(freed).toEqual(['maul-arc', 'chain-flail', 'threshold-charge', 'foremans-bellow']);
  });

  it('keeps Re-rivet and Last Link heroic only, and Re-rivet the one kickable bar', () => {
    expect(() => mechanic('korgath_the_bound', 're-rivet', 'normal')).toThrow();
    expect(() => mechanic('korgath_the_bound', 'last-link', 'normal')).toThrow();
    const rivet = mechanic('korgath_the_bound', 're-rivet', 'heroic');
    expect(rivet.flags).toContain('interruptible');
    expect(rivet.values?.delay).toBe(KORGATH_TUNING.rerivetDelay);
    expect(mechanic('korgath_the_bound', 'last-link', 'heroic').values?.every).toBe(
      KORGATH_TUNING.strainEveryLastLink,
    );
  });

  it('shows Strain at the sim range on Normal and at the heroic factor on Heroic', () => {
    const factor = HEROIC_DUNGEON_TUNING.gravewyrm_sanctum.mechanicDamageMultiplierByMob
      ?.korgath_the_bound as number;
    expect(mechanicFactor('gravewyrm_sanctum', 'korgath_the_bound', 'heroic')).toBe(factor);
    expect(mechanicFactor('gravewyrm_sanctum', 'korgath_the_bound', 'normal')).toBe(1);
    const normal = mechanic('korgath_the_bound', 'strain', 'normal');
    const heroic = mechanic('korgath_the_bound', 'strain', 'heroic');
    expect([normal.values?.min, normal.values?.max]).toEqual([
      KORGATH_TUNING.strainMin,
      KORGATH_TUNING.strainMax,
    ]);
    expect([heroic.values?.min, heroic.values?.max]).toEqual([
      Math.round(KORGATH_TUNING.strainMin * factor),
      Math.round(KORGATH_TUNING.strainMax * factor),
    ]);
    expect(heroic.marks).toEqual(['heroicChanged']);
    expect(heroic.compare?.heroic.min).toBe(heroic.values?.min);
  });

  it('prints every lane at the reach the sim hits and the floor telegraph draws', () => {
    // The lanes reach from the caster's centre: the tuning length plus the
    // body, never the tuning length alone (a player standing at the printed
    // distance would still be hit).
    const flail = mechanic('korgath_the_bound', 'chain-flail', 'normal').values?.length;
    const charge = mechanic('korgath_the_bound', 'threshold-charge', 'normal').values?.length;
    const trample = mechanic('sledge_tusker', 'trample', 'normal').values?.length;
    expect(flail).toBe(SANCTUM_CAST_SPECS[KORGATH_CHAIN_FLAIL].range);
    expect(charge).toBe(SANCTUM_CAST_SPECS[KORGATH_THRESHOLD_CHARGE].range);
    expect(trample).toBe(sanctumTelegraphSpecs()[TUSKER_TRAMPLE].range);
    expect(flail).toBe(KORGATH_TUNING.flailLength + KORGATH_BODY);
    expect(trample).toBeGreaterThan(TUSKER_TUNING.trampleLength);
  });

  it('pins the Tusker thresholds and the Korzul flights to the sim', () => {
    const tusker = dungeonJournalBossView(boss('sledge_tusker'), 'normal');
    expect(tusker.phases.find((p) => p.id === 'spill')?.values?.health).toBe(
      TUSKER_TUNING.spillAtHpPct,
    );
    expect(tusker.phases.find((p) => p.id === 'enrage')?.values?.health).toBe(
      TUSKER_TUNING.enrageAtHpPct,
    );
    const korzul = dungeonJournalBossView(boss('korzul_the_gravewyrm'), 'heroic');
    expect(korzul.phases.find((p) => p.id === 'flights')?.values).toEqual({
      first: KORZUL_TUNING.flightAtHpPct[0],
      second: KORZUL_TUNING.flightAtHpPct[1],
    });
    const water = mechanic('korzul_the_gravewyrm', 'open-water', 'heroic');
    expect(water.values?.perSecond).toBe(KORZUL_TUNING.quenchPerSecondHeroic);
  });
});

describe('Wildheart Basin facts', () => {
  const def = DUNGEON_JOURNALS.find((d) => d.dungeonId === 'wildheart_basin');
  if (!def) throw new Error('wildheart journal missing');
  const mechanic = (mobId: string, id: string, tier: JournalDifficulty) => {
    const boss = def.bosses.find((b) => b.mobId === mobId);
    if (!boss) throw new Error(mobId);
    const found = dungeonJournalBossView(boss, tier)
      .phases.flatMap((p) => p.mechanics)
      .find((m) => m.id === id);
    if (!found) throw new Error(`${mobId} ${id} ${tier}`);
    return found;
  };

  it('runs the route Saurian, Beastmaster, Gorgebloom, Zulgar', () => {
    expect(def.bosses.map((b) => [b.mobId, b.rank])).toEqual([
      ['great_saurian', 'miniboss'],
      ['wildheart_beastmaster', 'boss'],
      ['the_gorgebloom', 'boss'],
      ['wildheart_high_priest', 'final'],
    ]);
  });

  it('grows the Pack Bond reach on Heroic and keeps Heel! and Ambush heroic only', () => {
    expect(mechanic('wildheart_beastmaster', 'pack-bond', 'normal').values?.reach).toBe(
      BEAST_TUNING.bondReach,
    );
    const heroicBond = mechanic('wildheart_beastmaster', 'pack-bond', 'heroic');
    expect(heroicBond.values?.reach).toBe(BEAST_TUNING.heroicBondReach);
    expect(heroicBond.marks).toEqual(['heroicChanged']);
    expect(() => mechanic('wildheart_beastmaster', 'heel', 'normal')).toThrow();
    expect(mechanic('wildheart_beastmaster', 'heel', 'heroic').marks).toEqual(['heroicOnly']);
    expect(() => mechanic('wildheart_high_priest', 'ambush', 'normal')).toThrow();
  });

  it('flags Ancestral Sap as the kickable heal and pins the hunt to the sim', () => {
    expect(mechanic('great_saurian', 'ancestral-sap', 'normal').flags).toContain('interruptible');
    const hunt = mechanic('wildheart_high_priest', 'spirit-of-the-hunt', 'heroic');
    expect([hunt.values?.first, hunt.values?.second]).toEqual(ZULGAR_TUNING.huntAtHpPct);
    const factor = mechanicFactor('wildheart_basin', 'wildheart_high_priest', 'heroic');
    expect(hunt.values?.maul).toBe(Math.round(ZULGAR_TUNING.maulDamage * factor));
    expect(mechanic('wildheart_high_priest', 'spirit-of-the-hunt', 'normal').values?.maul).toBe(
      ZULGAR_TUNING.maulDamage,
    );
  });

  it('describes spear rescue, prepared glyphs and the permanent final hunt', () => {
    const spear = mechanic('wildheart_high_priest', 'hunting-spear', 'heroic');
    const factor = mechanicFactor('wildheart_basin', 'wildheart_high_priest', 'heroic');
    expect(spear.values?.bleed).toBe(Math.round(ZULGAR_TUNING.pinBleed * factor));
    expect(spear.values?.pull).toBe(ZULGAR_TUNING.spearPullSeconds);
    expect(spear.values?.self).toBe(ZULGAR_TUNING.spearWrenchSeconds);
    const glyphs = mechanic('wildheart_high_priest', 'sun-glyphs', 'normal');
    expect(glyphs.values?.kindle).toBe(ZULGAR_TUNING.glyphKindleSeconds);
    expect(glyphs.values?.dark).toBe(ZULGAR_TUNING.glyphColdSeconds);
    expect(glyphs.values?.vulnerability).toBe(ZULGAR_TUNING.sunstruckVuln);
    expect(rendered(glyphs.responseKey)).toContain('Unmarked players light glyphs');
    expect(() => mechanic('wildheart_high_priest', 'enrage', 'normal')).toThrow();
    expect(mechanic('wildheart_high_priest', 'idol-hunt', 'normal').values?.every).toBe(
      ZULGAR_TUNING.finalPreySeconds,
    );
    const breath = mechanic('wildheart_high_priest', 'idol-breath', 'heroic');
    expect(breath.values?.min).toBe(Math.round(ZULGAR_TUNING.breathMin * factor));
    expect(breath.values?.max).toBe(Math.round(ZULGAR_TUNING.breathMax * factor));
    expect(breath.values?.warning).toBe(ZULGAR_TUNING.breathWarning);
  });

  it('says hunt stuns last half as long only while the sim halves them', () => {
    const glyphs = mechanic('wildheart_high_priest', 'sun-glyphs', 'normal');
    expect(rendered(glyphs.summaryKey, glyphs.values, glyphs.percentValues)).toContain(
      'stuns last half as long',
    );
    // glyphSummary states the share in words, so the tuning is pinned here.
    expect(ZULGAR_TUNING.huntStunScale).toBe(0.5);
  });
});

describe('Hollow Crypt facts', () => {
  const def = DUNGEON_JOURNALS.find((d) => d.dungeonId === 'hollow_crypt');
  if (!def) throw new Error('crypt journal missing');
  const mechanic = (mobId: string, id: string, tier: JournalDifficulty) => {
    const boss = def.bosses.find((b) => b.mobId === mobId);
    if (!boss) throw new Error(mobId);
    const found = dungeonJournalBossView(boss, tier)
      .phases.flatMap((p) => p.mechanics)
      .find((m) => m.id === id);
    if (!found) throw new Error(`${mobId} ${id} ${tier}`);
    return found;
  };

  it('runs the route drake, Marrow, Lady, Ilvane, Morthen, Knellwyrm', () => {
    expect(def.bosses.map((b) => [b.mobId, b.rank])).toEqual([
      ['crypt_ossuary_drake', 'miniboss'],
      ['sexton_marrow', 'boss'],
      ['rimeweb', 'boss'],
      ['cantor_ilvane', 'boss'],
      ['morthen', 'final'],
      ['crypt_knellwyrm', 'miniboss'],
    ]);
  });

  it('gives the Embrace its real window and break share per tier', () => {
    const normal = mechanic('rimeweb', 'frozen-embrace', 'normal');
    const heroic = mechanic('rimeweb', 'frozen-embrace', 'heroic');
    expect(normal.values?.hold).toBe(LADY_TUNING.embraceRise + LADY_TUNING.embraceHold);
    expect(normal.values?.share).toBe(embraceBreakShare(false));
    expect(heroic.values?.share).toBe(embraceBreakShare(true));
    expect(heroic.values?.victims).toBe(LADY_TUNING.embraceVictimsHeroic);
  });

  it('prices the Burial Toll with its own heroic factor, and the candles by tier', () => {
    const factor = mechanicFactor('hollow_crypt', 'sexton_marrow', 'heroic');
    const base = tollDamageRange(true);
    expect(mechanic('sexton_marrow', 'burial-toll', 'heroic').values?.min).toBe(
      Math.round(base.min * factor),
    );
    expect(mechanic('morthen', 'relight', 'normal').values?.drain).toBeCloseTo(
      MORTHEN_TUNING.relightDrainPct * MORTHEN_TUNING.relightChannel,
    );
    expect(mechanic('morthen', 'relight', 'heroic').values?.drain).toBeCloseTo(
      MORTHEN_TUNING.relightDrainPctHeroic * MORTHEN_TUNING.relightChannel,
    );
  });

  it('marks the Dirge kickable and the Unbroken Verse not, heroic only', () => {
    expect(mechanic('cantor_ilvane', 'dirge-of-the-hollow', 'normal').flags).toContain(
      'interruptible',
    );
    expect(() => mechanic('cantor_ilvane', 'unbroken-verse', 'normal')).toThrow();
    expect(mechanic('cantor_ilvane', 'unbroken-verse', 'heroic').flags).not.toContain(
      'interruptible',
    );
  });
});

describe('Sunken Bastion facts', () => {
  const def = DUNGEON_JOURNALS.find((d) => d.dungeonId === 'sunken_bastion');
  if (!def) throw new Error('bastion journal missing');
  const mechanic = (mobId: string, id: string, tier: JournalDifficulty) => {
    const boss = def.bosses.find((b) => b.mobId === mobId);
    if (!boss) throw new Error(mobId);
    const found = dungeonJournalBossView(boss, tier)
      .phases.flatMap((p) => p.mechanics)
      .find((m) => m.id === id);
    if (!found) throw new Error(`${mobId} ${id} ${tier}`);
    return found;
  };

  it('runs the route Captain, Olen, Turnkey, Ossick, Vael', () => {
    expect(def.bosses.map((b) => [b.mobId, b.rank])).toEqual([
      ['turretback_hermit', 'miniboss'],
      ['knight_commander_olen', 'boss'],
      ['gaol_turnkey', 'miniboss'],
      ['gaoler_ossick', 'boss'],
      ['vael_the_mistcaller', 'final'],
    ]);
  });

  it('prices heroic Hallowed Brine from its own heroic base and keeps no bar kickable', () => {
    const factor = mechanicFactor('sunken_bastion', 'knight_commander_olen', 'heroic');
    expect(mechanic('knight_commander_olen', 'hallowed-brine', 'heroic').values?.perSecond).toBe(
      Math.round(OLEN_KIT.brinePerSecondHeroic * factor),
    );
    expect(mechanic('knight_commander_olen', 'hallowed-brine', 'normal').values?.perSecond).toBe(
      OLEN_KIT.brinePerSecond,
    );
    for (const boss of def.bosses) {
      for (const tier of ['normal', 'heroic'] as const) {
        for (const m of dungeonJournalBossView(boss, tier).phases.flatMap((p) => p.mechanics)) {
          expect(m.flags, `${boss.mobId} ${m.id}`).not.toContain('interruptible');
        }
      }
    }
  });

  it('describes Reaping Arc as the splash circle round the tank', () => {
    const arc = mechanic('knight_commander_olen', 'reaping-arc', 'normal');
    expect(arc.values?.radius).toBe(MOBS.knight_commander_olen?.cleave?.radius);
    expect(rendered(arc.summaryKey, arc.values, arc.percentValues)).toContain('within');
  });
});

describe('Drowned Temple facts', () => {
  const def = DUNGEON_JOURNALS.find((d) => d.dungeonId === 'drowned_temple');
  if (!def) throw new Error('temple journal missing');
  const mechanic = (mobId: string, id: string, tier: JournalDifficulty) => {
    const boss = def.bosses.find((b) => b.mobId === mobId);
    if (!boss) throw new Error(mobId);
    const found = dungeonJournalBossView(boss, tier)
      .phases.flatMap((p) => p.mechanics)
      .find((m) => m.id === id);
    if (!found) throw new Error(`${mobId} ${id} ${tier}`);
    return found;
  };

  it('runs the route Selthe, Hydra, Colossus, Ysolei', () => {
    expect(def.bosses.map((b) => [b.mobId, b.rank])).toEqual([
      ['choirmother_selthe', 'boss'],
      ['mere_hydra_head_center', 'boss'],
      ['tideglass_colossus', 'boss'],
      ['ysolei', 'final'],
    ]);
  });

  it('replaces Sea-Song with Score thresholds, relay rules and scaled mistakes', () => {
    expect(() => mechanic('choirmother_selthe', 'sea-song', 'normal')).toThrow();
    for (const tier of TIERS) {
      const score = mechanic('choirmother_selthe', 'score', tier);
      const factor = mechanicFactor('drowned_temple', 'choirmother_selthe', tier);
      expect([score.values?.first, score.values?.second]).toEqual(SELTHE_TUNING.scoreAt);
      expect([score.values?.notes, score.values?.finalNotes]).toEqual(SELTHE_TUNING.scoreNotes);
      expect([score.values?.answer, score.values?.finalAnswer]).toEqual(SELTHE_TUNING.scoreAnswer);
      expect(score.values?.falseNote).toBe(Math.round(SELTHE_TUNING.falseNoteDamage * factor));
      expect(score.values?.min).toBe(Math.round(SELTHE_TUNING.discordMin * factor));
      expect(score.values?.max).toBe(Math.round(SELTHE_TUNING.discordMax * factor));
      expect(score.values?.bonusSeconds).toBe(SELTHE_TUNING.brokenVulnSeconds);
      expect(score.values?.vulnerability).toBe(SELTHE_TUNING.brokenVuln);
      expect(rendered(score.responseKey)).toContain('Alternate correct notes');
      expect(rendered(score.responseKey)).toContain('a sole survivor can finish alone');
    }
  });

  it('marks only the aria kickable, and the hydra regrowth per tier', () => {
    expect(mechanic('choirmother_selthe', 'drowning-aria', 'normal').flags).toContain(
      'interruptible',
    );
    expect(mechanic('choirmother_selthe', 'moonwater-bolt', 'normal').flags).not.toContain(
      'interruptible',
    );
    expect(mechanic('mere_hydra_head_center', 'three-heads', 'normal').values?.share).toBe(
      hydraRegrowShare(false),
    );
    expect(mechanic('mere_hydra_head_center', 'three-heads', 'heroic').values?.share).toBe(
      hydraRegrowShare(true),
    );
    // The three heads draw as one bodyless model: the page keeps its portrait.
    expect(journalModelFor('mere_hydra_head_center')).toBeNull();
  });

  it('sends four tears on Heroic and the Falling Moon faster', () => {
    expect(mechanic('ysolei', 'beckoning-moon', 'heroic').values?.count).toBe(
      YSOLEI_MOON_TUNING.tearCountHeroic,
    );
    expect(mechanic('ysolei', 'falling-moon', 'heroic').values?.cast).toBe(
      YSOLEI_MOON_TUNING.fallingCastHeroic,
    );
  });
});
