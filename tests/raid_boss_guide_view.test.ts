import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
} from '../src/sim/encounters/ignivar';
import {
  NYTHRAXIS_DEATHLESS_PCT,
  NYTHRAXIS_DEATHLESS_PCT_HEROIC,
  NYTHRAXIS_GRAVEBREAKER_HALF_ARC,
  NYTHRAXIS_PHASE_TWO_HP,
  NYTHRAXIS_SOUL_REND_MARKS,
  NYTHRAXIS_SOUL_REND_MARKS_HEROIC,
} from '../src/sim/encounters/nythraxis';
import {
  VARKHUL_FORGESTORM_WAVES,
  VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS,
  VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD,
  VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD,
} from '../src/sim/encounters/varkhul';
import { IGNIVAR_JUDGMENT_HP_THRESHOLD } from '../src/sim/ignivar_forge_judgment';
import {
  NYTHRAXIS_ASCENSION_PER_STACK_HEROIC,
  NYTHRAXIS_ASCENSION_PER_STACK_NORMAL,
  NYTHRAXIS_BOUND_VULNERABILITY,
  NYTHRAXIS_SIGIL_EVERY_HEROIC,
  NYTHRAXIS_SIGIL_EVERY_NORMAL,
  NYTHRAXIS_UNBOUND_HIT_MAX_HP_HEROIC,
  NYTHRAXIS_UNBOUND_HIT_MAX_HP_NORMAL,
} from '../src/sim/nythraxis_binding_sigil';
import {
  NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC,
  NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL,
} from '../src/sim/nythraxis_bone_spike';
import {
  NYTHRAXIS_BONE_STORM_CHARGE_SECONDS,
  NYTHRAXIS_BONE_STORM_CHARGES,
  NYTHRAXIS_BONE_STORM_FIRST_SECONDS,
  NYTHRAXIS_BONE_STORM_GRAVEBREAKER_REARM_SECONDS,
  NYTHRAXIS_BONE_STORM_RADIUS,
  NYTHRAXIS_BONE_STORM_SECONDS,
  NYTHRAXIS_BONE_STORM_SPEED_MULT,
  NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS,
  nythraxisBoneSlamDamageMaxHp,
  nythraxisBoneStormCadence,
  nythraxisBoneStormWhirlTickMaxHp,
} from '../src/sim/nythraxis_bone_storm';
import {
  NYTHRAXIS_DREAD_CURSE_PER_STACK_HEROIC,
  NYTHRAXIS_DREAD_CURSE_PER_STACK_NORMAL,
  NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS,
} from '../src/sim/nythraxis_dread_curse';
import {
  NYTHRAXIS_ENRAGE_DAMAGE_BONUS,
  NYTHRAXIS_ENRAGE_HASTE_BONUS,
  NYTHRAXIS_ENRAGE_RAMP_STEP,
  NYTHRAXIS_ENRAGE_WARN_SECONDS,
  nythraxisEnrageRampEvery,
  nythraxisEnrageSeconds,
} from '../src/sim/nythraxis_enrage_clock';
import {
  NYTHRAXIS_GRAVEFIRE_EVERY_HEROIC,
  NYTHRAXIS_GRAVEFIRE_EVERY_NORMAL,
  NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_HEROIC,
  NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_NORMAL,
} from '../src/sim/nythraxis_gravefire';
import {
  NYTHRAXIS_PHASE_THREE_HP,
  nythraxisKingsWrathDamageBonus,
  nythraxisWrathGraveEruptionEvery,
  nythraxisWrathGravefireEvery,
} from '../src/sim/nythraxis_kings_wrath';
import {
  NYTHRAXIS_SOULFIRE_TICK_MAX_HP_HEROIC,
  NYTHRAXIS_SOULFIRE_TICK_MAX_HP_NORMAL,
} from '../src/sim/nythraxis_soulfire';
import { NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { VARKHUL_ANVILS_DECREE_STRIKES } from '../src/sim/varkhul_anvils_decree';
import {
  VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
  VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
} from '../src/sim/varkhul_shared_pyre';
import { formatNumber, setLanguage, type TranslationKey, t } from '../src/ui/i18n';
import { abilityIconRecipe, isUnknownIconRecipe } from '../src/ui/icons';
import {
  NYTHRAXIS_BOSS_ARENA_ID,
  type RaidBossGuideView,
  raidBossGuideBossForDungeon,
  raidBossGuideView,
} from '../src/ui/raid_boss_guide_view';

// The window's value formatting (raid_boss_guide_window.ts formattedValues), so a
// rendered summary can be checked for unfilled {tokens} against the real catalog.
function renderedValues(
  values: Readonly<Record<string, number>> | undefined,
  percentValues: readonly string[] = [],
): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      formatNumber(
        value,
        percentValues.includes(name) ? { style: 'percent', maximumFractionDigits: 0 } : undefined,
      ),
    ]),
  );
}

function renderedGuideText(view: RaidBossGuideView): string[] {
  const out: string[] = [];
  out.push(t(view.overviewKey as TranslationKey));
  for (const phase of view.phases) {
    const phaseValues = renderedValues(phase.values, phase.percentValues);
    out.push(
      t(phase.nameKey as TranslationKey),
      t(phase.summaryKey as TranslationKey, phaseValues),
    );
    for (const mechanic of phase.mechanics) {
      const values = renderedValues(mechanic.values, mechanic.percentValues);
      out.push(
        t(mechanic.nameKey as TranslationKey, values),
        t(mechanic.summaryKey as TranslationKey, values),
        t(mechanic.responseKey as TranslationKey, values),
      );
    }
  }
  return out;
}

const pct = (frac: number) => formatNumber(frac, { style: 'percent', maximumFractionDigits: 0 });

function mechanicTextKeys(
  view: ReturnType<typeof raidBossGuideView>,
  mechanicIds: readonly string[],
): Record<string, { summaryKey: string; responseKey: string }> {
  const mechanics = new Map(
    view.phases
      .flatMap((phase) => phase.mechanics)
      .map((mechanic) => [mechanic.id, mechanic] as const),
  );

  return Object.fromEntries(
    mechanicIds.map((mechanicId) => {
      const mechanic = mechanics.get(mechanicId);
      if (!mechanic) throw new Error(`missing guide mechanic: ${mechanicId}`);
      return [mechanicId, { summaryKey: mechanic.summaryKey, responseKey: mechanic.responseKey }];
    }),
  );
}

describe('raid boss guide view', () => {
  it('selects the next boss from every Ignivar raid room and stays absent elsewhere', () => {
    expect(raidBossGuideBossForDungeon('ignivar_forge_approach')).toBe('ignivar');
    expect(raidBossGuideBossForDungeon('ignivar_raid_arena')).toBe('ignivar');
    expect(raidBossGuideBossForDungeon('ignivar_molten_assembly')).toBe('varkhul');
    expect(raidBossGuideBossForDungeon('ignivar_inner_crucible')).toBe('varkhul');
    expect(raidBossGuideBossForDungeon('hollow_crypt')).toBeNull();
    expect(raidBossGuideBossForDungeon(null)).toBeNull();
  });

  it('selects Nythraxis inside the Abandoned Crypt raid arena only', () => {
    expect(NYTHRAXIS_BOSS_ARENA_ID).toBe('nythraxis_boss_arena');
    expect(raidBossGuideBossForDungeon('nythraxis_boss_arena')).toBe('nythraxis');
    // The solo attunement crypt is not the raid room.
    expect(raidBossGuideBossForDungeon('nythraxis_crypt')).toBeNull();
  });

  it('builds Nythraxis as three phases without adds and with sim-sourced numbers', () => {
    const normal = raidBossGuideView('nythraxis', 'normal');
    const heroic = raidBossGuideView('nythraxis', 'heroic');
    const normalMechanics = normal.phases.flatMap((phase) => phase.mechanics);
    const heroicMechanics = heroic.phases.flatMap((phase) => phase.mechanics);

    expect(normal.bossId).toBe(NYTHRAXIS_BOSS_ID);
    expect(normal.bossId).toBe('nythraxis_scourge_of_thornpeak');
    expect(normal.portraitUrl).toBe('/ui/mobs/nythraxis_scourge_of_thornpeak.webp');
    expect(normal.overviewKey).toBe('hudChrome.raidBossGuide.nythraxis.overview');
    expect(normal.phases.map((phase) => phase.id)).toEqual(['throne', 'wardstones', 'kings-wrath']);
    expect(normalMechanics.map((mechanic) => mechanic.id)).toEqual([
      'gravebreaker',
      'dread-curse',
      'bone-spike',
      'grave-eruption',
      'binding-sigil',
      'soul-rend',
      'soulfire',
      'gravefire',
      'deathless-rage',
      'kings-wrath',
      'bone-storm',
      'crown-endures',
    ]);
    expect(heroicMechanics.map((mechanic) => mechanic.id)).toEqual([
      'gravebreaker',
      'dread-curse',
      'bone-spike',
      'grave-eruption',
      'binding-sigil',
      'soul-rend',
      'soulfire',
      'gravefire',
      'deathless-rage',
      'kings-wrath',
      'bone-storm',
      'crown-endures',
    ]);
    // Raise Fallen and the heroic court are switched off with the adds
    // (NYTHRAXIS_ADDS_ENABLED), so neither tier lists them.
    expect(normal.phases.map((phase) => phase.mechanics.length)).toEqual([5, 4, 3]);
    expect(heroic.phases.map((phase) => phase.mechanics.length)).toEqual([5, 4, 3]);

    expect(normal.phases.find((phase) => phase.id === 'throne')?.values).toBeUndefined();
    expect(normal.phases.find((phase) => phase.id === 'wardstones')).toMatchObject({
      values: { health: NYTHRAXIS_PHASE_TWO_HP },
      percentValues: ['health'],
    });
    expect(normal.phases.find((phase) => phase.id === 'kings-wrath')).toMatchObject({
      nameKey: 'hudChrome.raidBossGuide.nythraxis.phaseKingsWrathName',
      summaryKey: 'hudChrome.raidBossGuide.nythraxis.phaseKingsWrathSummary',
      values: {
        health: NYTHRAXIS_PHASE_THREE_HP,
        bonusNormal: nythraxisKingsWrathDamageBonus('normal'),
        bonusHeroic: nythraxisKingsWrathDamageBonus('heroic'),
        eruptionEveryNormal: nythraxisWrathGraveEruptionEvery('normal'),
        eruptionEveryHeroic: nythraxisWrathGraveEruptionEvery('heroic'),
        gravefireEveryNormal: nythraxisWrathGravefireEvery('normal'),
        gravefireEveryHeroic: nythraxisWrathGravefireEvery('heroic'),
      },
      percentValues: ['health', 'bonusNormal', 'bonusHeroic'],
    });
    expect(NYTHRAXIS_PHASE_TWO_HP).toBe(0.7);
    expect(NYTHRAXIS_PHASE_THREE_HP).toBe(0.3);

    const dreadCurse = normalMechanics.find((mechanic) => mechanic.id === 'dread-curse');
    expect(dreadCurse?.roles).toEqual(['tank', 'healer']);
    expect(dreadCurse?.flags).toEqual(['important']);
    expect(dreadCurse?.values).toMatchObject({ stacks: NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS });
    expect(NYTHRAXIS_DREAD_CURSE_TANK_SWAP_STACKS).toBe(2);

    const gravebreaker = normalMechanics.find((mechanic) => mechanic.id === 'gravebreaker');
    expect(gravebreaker?.values?.arc).toBe(
      Math.round((NYTHRAXIS_GRAVEBREAKER_HALF_ARC * 2 * 180) / Math.PI),
    );
    expect(gravebreaker?.values?.arc).toBe(120);
    expect(gravebreaker?.percentValues).toEqual(['splash']);

    expect(normalMechanics.find((mechanic) => mechanic.id === 'bone-spike')?.roles).toEqual([
      'damage',
      'healer',
    ]);
    expect(normalMechanics.find((mechanic) => mechanic.id === 'deathless-rage')?.flags).toEqual([
      'deadly',
      'interruptible',
      'important',
    ]);
    expect(normalMechanics.find((mechanic) => mechanic.id === 'binding-sigil')).toMatchObject({
      roles: ['tank', 'damage'],
      flags: ['deadly', 'important'],
      iconId: 'raid_nythraxis_binding_sigil',
    });
    expect(normalMechanics.find((mechanic) => mechanic.id === 'gravefire')).toMatchObject({
      roles: ['all'],
      flags: ['deadly'],
      iconId: 'raid_nythraxis_gravefire',
    });
    expect(normalMechanics.find((mechanic) => mechanic.id === 'soulfire')).toMatchObject({
      roles: ['all'],
      flags: ['important'],
      iconId: 'raid_nythraxis_soulfire',
    });
    expect(normalMechanics.find((mechanic) => mechanic.id === 'kings-wrath')).toMatchObject({
      roles: ['all'],
      flags: ['important'],
      iconId: 'raid_nythraxis_kings_wrath',
      values: {
        bonusNormal: nythraxisKingsWrathDamageBonus('normal'),
        bonusHeroic: nythraxisKingsWrathDamageBonus('heroic'),
        eruptionEveryNormal: nythraxisWrathGraveEruptionEvery('normal'),
        eruptionEveryHeroic: nythraxisWrathGraveEruptionEvery('heroic'),
        gravefireEveryNormal: nythraxisWrathGravefireEvery('normal'),
        gravefireEveryHeroic: nythraxisWrathGravefireEvery('heroic'),
      },
      percentValues: ['bonusNormal', 'bonusHeroic'],
    });
    expect(normalMechanics.find((mechanic) => mechanic.id === 'bone-storm')).toMatchObject({
      roles: ['all'],
      flags: ['deadly', 'important'],
      iconId: 'raid_nythraxis_bone_storm',
      values: {
        first: NYTHRAXIS_BONE_STORM_FIRST_SECONDS,
        everyNormal: nythraxisBoneStormCadence('normal'),
        everyHeroic: nythraxisBoneStormCadence('heroic'),
        duration: NYTHRAXIS_BONE_STORM_SECONDS,
        charges: NYTHRAXIS_BONE_STORM_CHARGES,
        chargeSeconds: NYTHRAXIS_BONE_STORM_CHARGE_SECONDS,
        speed: NYTHRAXIS_BONE_STORM_SPEED_MULT,
        radius: NYTHRAXIS_BONE_STORM_RADIUS,
        whirlNormal: nythraxisBoneStormWhirlTickMaxHp('normal'),
        whirlHeroic: nythraxisBoneStormWhirlTickMaxHp('heroic'),
        slamNormal: nythraxisBoneSlamDamageMaxHp('normal'),
        slamHeroic: nythraxisBoneSlamDamageMaxHp('heroic'),
        spikeAt: NYTHRAXIS_BONE_STORM_SPIKE_AT_SECONDS,
        rearm: NYTHRAXIS_BONE_STORM_GRAVEBREAKER_REARM_SECONDS,
      },
      percentValues: ['whirlNormal', 'whirlHeroic', 'slamNormal', 'slamHeroic'],
    });
    expect(normalMechanics.find((mechanic) => mechanic.id === 'crown-endures')).toMatchObject({
      roles: ['damage'],
      flags: ['deadly'],
      iconId: 'raid_nythraxis_crown_endures',
      values: {
        enrageNormal: nythraxisEnrageSeconds('normal'),
        enrageHeroic: nythraxisEnrageSeconds('heroic'),
        warn60: NYTHRAXIS_ENRAGE_WARN_SECONDS[0],
        warn30: NYTHRAXIS_ENRAGE_WARN_SECONDS[1],
        warn10: NYTHRAXIS_ENRAGE_WARN_SECONDS[2],
        damage: NYTHRAXIS_ENRAGE_DAMAGE_BONUS,
        haste: NYTHRAXIS_ENRAGE_HASTE_BONUS,
        rampEveryNormal: nythraxisEnrageRampEvery('normal'),
        rampEveryHeroic: nythraxisEnrageRampEvery('heroic'),
        rampStep: NYTHRAXIS_ENRAGE_RAMP_STEP,
      },
      percentValues: ['damage', 'haste', 'rampStep'],
    });
    expect(heroicMechanics.find((mechanic) => mechanic.id === 'deathless-court')).toBeUndefined();
    expect(heroicMechanics.find((mechanic) => mechanic.id === 'raise-fallen')).toBeUndefined();
    expect(normalMechanics.find((mechanic) => mechanic.id === 'raise-fallen')).toBeUndefined();
  });

  it('pins every Nythraxis Normal and Heroic text-key branch to its mechanic', () => {
    const normal = raidBossGuideView('nythraxis', 'normal');
    const heroic = raidBossGuideView('nythraxis', 'heroic');
    const difficultyMechanics = [
      'dread-curse',
      'bone-spike',
      'grave-eruption',
      'binding-sigil',
      'soul-rend',
      'soulfire',
      'gravefire',
      'deathless-rage',
      'bone-storm',
      'crown-endures',
    ];
    const base = 'hudChrome.raidBossGuide.nythraxis';

    expect(mechanicTextKeys(normal, difficultyMechanics)).toEqual({
      'dread-curse': {
        summaryKey: `${base}.dreadCurseSummary`,
        responseKey: `${base}.dreadCurseResponse`,
      },
      'bone-spike': {
        summaryKey: `${base}.boneSpikeSummary`,
        responseKey: `${base}.boneSpikeResponse`,
      },
      'grave-eruption': {
        summaryKey: `${base}.graveEruptionSummary`,
        responseKey: `${base}.graveEruptionResponse`,
      },
      'binding-sigil': {
        summaryKey: `${base}.bindingSigilSummary`,
        responseKey: `${base}.bindingSigilResponse`,
      },
      'soul-rend': {
        summaryKey: `${base}.soulRendSummary`,
        responseKey: `${base}.soulRendResponse`,
      },
      soulfire: {
        summaryKey: `${base}.soulfireSummary`,
        responseKey: `${base}.soulfireResponse`,
      },
      gravefire: {
        summaryKey: `${base}.gravefireSummary`,
        responseKey: `${base}.gravefireResponse`,
      },
      'deathless-rage': {
        summaryKey: `${base}.deathlessRageSummary`,
        responseKey: `${base}.deathlessRageResponse`,
      },
      'bone-storm': {
        summaryKey: `${base}.boneStormSummary`,
        responseKey: `${base}.boneStormResponse`,
      },
      'crown-endures': {
        summaryKey: `${base}.crownEnduresSummary`,
        responseKey: `${base}.crownEnduresResponse`,
      },
    });
    expect(mechanicTextKeys(heroic, difficultyMechanics)).toEqual({
      'dread-curse': {
        summaryKey: `${base}.dreadCurseHeroicSummary`,
        responseKey: `${base}.dreadCurseResponse`,
      },
      'bone-spike': {
        summaryKey: `${base}.boneSpikeHeroicSummary`,
        responseKey: `${base}.boneSpikeResponse`,
      },
      'grave-eruption': {
        summaryKey: `${base}.graveEruptionHeroicSummary`,
        responseKey: `${base}.graveEruptionResponse`,
      },
      'binding-sigil': {
        summaryKey: `${base}.bindingSigilHeroicSummary`,
        responseKey: `${base}.bindingSigilResponse`,
      },
      'soul-rend': {
        summaryKey: `${base}.soulRendHeroicSummary`,
        responseKey: `${base}.soulRendResponse`,
      },
      soulfire: {
        summaryKey: `${base}.soulfireHeroicSummary`,
        responseKey: `${base}.soulfireResponse`,
      },
      gravefire: {
        summaryKey: `${base}.gravefireHeroicSummary`,
        responseKey: `${base}.gravefireResponse`,
      },
      'deathless-rage': {
        summaryKey: `${base}.deathlessRageHeroicSummary`,
        responseKey: `${base}.deathlessRageResponse`,
      },
      'bone-storm': {
        summaryKey: `${base}.boneStormHeroicSummary`,
        responseKey: `${base}.boneStormResponse`,
      },
      'crown-endures': {
        summaryKey: `${base}.crownEnduresHeroicSummary`,
        responseKey: `${base}.crownEnduresResponse`,
      },
    });
    // Single-copy mechanics keep one key on both tiers.
    for (const view of [normal, heroic]) {
      expect(mechanicTextKeys(view, ['gravebreaker', 'kings-wrath'])).toEqual({
        gravebreaker: {
          summaryKey: `${base}.gravebreakerSummary`,
          responseKey: `${base}.gravebreakerResponse`,
        },
        'kings-wrath': {
          summaryKey: `${base}.kingsWrathSummary`,
          responseKey: `${base}.kingsWrathResponse`,
        },
      });
    }
  });

  it('resolves every Nythraxis key in the English catalog with every token filled', () => {
    setLanguage('en');
    for (const difficulty of ['normal', 'heroic'] as const) {
      const rendered = renderedGuideText(raidBossGuideView('nythraxis', difficulty));
      expect(rendered.length).toBeGreaterThan(0);
      for (const text of rendered) {
        expect(text, `${difficulty}: ${text}`).toMatch(/\S/);
        // A leftover {token} means the catalog names a value the view never supplies.
        expect(text, `${difficulty}: ${text}`).not.toMatch(/\{[A-Za-z0-9_]+\}/);
      }
    }
  });

  it('spells the tier-specific Nythraxis numbers from the live tuning', () => {
    setLanguage('en');
    const summaryOf = (view: RaidBossGuideView, id: string): string => {
      const mechanic = view.phases.flatMap((phase) => phase.mechanics).find((m) => m.id === id);
      if (!mechanic) throw new Error(`missing guide mechanic: ${id}`);
      return t(
        mechanic.summaryKey as TranslationKey,
        renderedValues(mechanic.values, mechanic.percentValues),
      );
    };
    const normal = raidBossGuideView('nythraxis', 'normal');
    const heroic = raidBossGuideView('nythraxis', 'heroic');

    expect(summaryOf(normal, 'dread-curse')).toContain(
      `by ${pct(NYTHRAXIS_DREAD_CURSE_PER_STACK_NORMAL)}`,
    );
    expect(summaryOf(heroic, 'dread-curse')).toContain(
      `by ${pct(NYTHRAXIS_DREAD_CURSE_PER_STACK_HEROIC)}`,
    );
    expect(summaryOf(normal, 'bone-spike')).toContain(
      `impales ${NYTHRAXIS_BONE_SPIKE_VICTIMS_NORMAL} raiders`,
    );
    expect(summaryOf(heroic, 'bone-spike')).toContain(
      `impales ${NYTHRAXIS_BONE_SPIKE_VICTIMS_HEROIC} raiders`,
    );
    expect(summaryOf(normal, 'soul-rend')).toContain(`marks ${NYTHRAXIS_SOUL_REND_MARKS} raiders`);
    expect(summaryOf(heroic, 'soul-rend')).toContain(
      `marks ${NYTHRAXIS_SOUL_REND_MARKS_HEROIC} raiders`,
    );
    expect(summaryOf(normal, 'deathless-rage')).toContain(`takes ${pct(NYTHRAXIS_DEATHLESS_PCT)}`);
    expect(summaryOf(heroic, 'deathless-rage')).toContain(
      `takes ${pct(NYTHRAXIS_DEATHLESS_PCT_HEROIC)}`,
    );
    expect(summaryOf(normal, 'binding-sigil')).toContain(
      `Every ${NYTHRAXIS_SIGIL_EVERY_NORMAL} sec`,
    );
    expect(summaryOf(heroic, 'binding-sigil')).toContain(
      `Every ${NYTHRAXIS_SIGIL_EVERY_HEROIC} sec`,
    );
    expect(summaryOf(normal, 'binding-sigil')).toContain(
      `${pct(NYTHRAXIS_ASCENSION_PER_STACK_NORMAL)} damage`,
    );
    expect(summaryOf(heroic, 'binding-sigil')).toContain(
      `${pct(NYTHRAXIS_ASCENSION_PER_STACK_HEROIC)} damage`,
    );
    expect(summaryOf(normal, 'binding-sigil')).toContain(
      `${pct(NYTHRAXIS_UNBOUND_HIT_MAX_HP_NORMAL)} of maximum health`,
    );
    expect(summaryOf(heroic, 'binding-sigil')).toContain(
      `${pct(NYTHRAXIS_UNBOUND_HIT_MAX_HP_HEROIC)} of maximum health`,
    );
    expect(summaryOf(normal, 'binding-sigil')).toContain(
      `${pct(NYTHRAXIS_BOUND_VULNERABILITY)} more damage`,
    );
    expect(summaryOf(normal, 'gravefire')).toContain(
      `Every ${NYTHRAXIS_GRAVEFIRE_EVERY_NORMAL} sec`,
    );
    expect(summaryOf(heroic, 'gravefire')).toContain(
      `Every ${NYTHRAXIS_GRAVEFIRE_EVERY_HEROIC} sec`,
    );
    expect(summaryOf(normal, 'gravefire')).toContain(
      `${pct(NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_NORMAL)} of maximum health`,
    );
    expect(summaryOf(heroic, 'gravefire')).toContain(
      `${pct(NYTHRAXIS_GRAVEFIRE_TICK_MAX_HP_HEROIC)} of maximum health`,
    );
    expect(summaryOf(normal, 'soulfire')).toContain(
      `${pct(NYTHRAXIS_SOULFIRE_TICK_MAX_HP_NORMAL)} of maximum health`,
    );
    expect(summaryOf(heroic, 'soulfire')).toContain(
      `${pct(NYTHRAXIS_SOULFIRE_TICK_MAX_HP_HEROIC)} of maximum health`,
    );
    expect(summaryOf(normal, 'kings-wrath')).toContain(
      `${pct(nythraxisKingsWrathDamageBonus('normal'))} more damage on Normal`,
    );
    expect(summaryOf(heroic, 'kings-wrath')).toContain(
      `${pct(nythraxisKingsWrathDamageBonus('heroic'))} on Heroic`,
    );
    expect(summaryOf(normal, 'bone-storm')).toContain(
      `every ${nythraxisBoneStormCadence('normal')} sec`,
    );
    expect(summaryOf(normal, 'bone-storm')).toContain(
      `${pct(nythraxisBoneSlamDamageMaxHp('normal'))} of maximum health`,
    );
    expect(summaryOf(heroic, 'bone-storm')).toContain(
      `${pct(nythraxisBoneSlamDamageMaxHp('heroic'))} of maximum health`,
    );
    expect(summaryOf(normal, 'crown-endures')).toContain(
      `At ${nythraxisEnrageSeconds('normal')} sec from the pull`,
    );
    expect(summaryOf(heroic, 'crown-endures')).toContain(
      `At ${nythraxisEnrageSeconds('heroic')} sec from the pull`,
    );
    expect(summaryOf(normal, 'crown-endures')).toContain('There is no timer bar.');
    expect(summaryOf(normal, 'crown-endures')).toContain(
      `${NYTHRAXIS_ENRAGE_WARN_SECONDS.join(', ').replace(', 10', ', and 10')} sec remaining`,
    );
    // The literal tuning the copy is written against; a retune must revisit the prose.
    expect(NYTHRAXIS_DREAD_CURSE_PER_STACK_NORMAL).toBe(0.35);
    expect(NYTHRAXIS_DREAD_CURSE_PER_STACK_HEROIC).toBe(0.45);
    expect(NYTHRAXIS_DEATHLESS_PCT_HEROIC).toBe(1.15);
  });

  it('builds Ignivar as a phased journal with his real portrait and role guidance', () => {
    const view = raidBossGuideView('ignivar', 'normal');

    expect(view.bossId).toBe('ignivar_herald_of_the_last_flame');
    expect(view.portraitUrl).toBe('/ui/mobs/ignivar_herald_of_the_last_flame.webp');
    expect(view.phases.map((phase) => phase.id)).toEqual([
      'opening',
      'apocalypse',
      'judgment',
      'finale',
    ]);
    expect(view.phases.flatMap((phase) => phase.mechanics).map((mechanic) => mechanic.id)).toEqual([
      'forge-strike',
      'brand-of-the-pyre',
      'searing-torrent',
      'rain-of-cinders',
      'revolving-inferno',
      'forge-wave',
      'apocalypse',
      'judgment-of-the-forge',
      'last-inferno',
    ]);
    expect(
      view.phases
        .flatMap((phase) => phase.mechanics)
        .find((mechanic) => mechanic.id === 'forge-strike')?.roles,
    ).toEqual(['tank', 'healer']);
    expect(view.phases.find((phase) => phase.id === 'apocalypse')).toMatchObject({
      values: { health: IGNIVAR_APOCALYPSE_HP_THRESHOLD },
      percentValues: ['health'],
    });
    expect(view.phases.find((phase) => phase.id === 'judgment')?.values).toEqual({
      health: IGNIVAR_JUDGMENT_HP_THRESHOLD,
    });
    expect(view.phases.find((phase) => phase.id === 'finale')?.values).toEqual({
      health: IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
    });
    expect(
      view.phases
        .flatMap((phase) => phase.mechanics)
        .find((mechanic) => mechanic.id === 'forge-strike')?.values,
    ).toEqual({ stacks: 2 });
  });

  it('adds Heroic-only mechanics and selects Heroic-specific explanations', () => {
    const normal = raidBossGuideView('ignivar', 'normal');
    const heroic = raidBossGuideView('ignivar', 'heroic');
    const normalMechanics = normal.phases.flatMap((phase) => phase.mechanics);
    const heroicMechanics = heroic.phases.flatMap((phase) => phase.mechanics);

    expect(normalMechanics.some((mechanic) => mechanic.id === 'chains-of-the-forge')).toBe(false);
    expect(heroicMechanics.some((mechanic) => mechanic.id === 'chains-of-the-forge')).toBe(true);
    expect(normalMechanics.find((mechanic) => mechanic.id === 'forge-wave')?.summaryKey).toBe(
      'hudChrome.raidBossGuide.ignivar.forgeWaveSummary',
    );
    expect(heroicMechanics.find((mechanic) => mechanic.id === 'forge-wave')?.summaryKey).toBe(
      'hudChrome.raidBossGuide.ignivar.forgeWaveHeroicSummary',
    );
    expect(normal.phases.find((phase) => phase.id === 'judgment')?.summaryKey).toBe(
      'hudChrome.raidBossGuide.ignivar.phaseJudgmentSummary',
    );
    expect(heroic.phases.find((phase) => phase.id === 'judgment')?.summaryKey).toBe(
      'hudChrome.raidBossGuide.ignivar.phaseJudgmentHeroicSummary',
    );
    expect(
      normalMechanics.find((mechanic) => mechanic.id === 'judgment-of-the-forge')?.summaryKey,
    ).toBe('hudChrome.raidBossGuide.ignivar.judgmentSummary');
    expect(
      heroicMechanics.find((mechanic) => mechanic.id === 'judgment-of-the-forge')?.summaryKey,
    ).toBe('hudChrome.raidBossGuide.ignivar.judgmentHeroicSummary');

    const difficultyMechanics = [
      'brand-of-the-pyre',
      'searing-torrent',
      'rain-of-cinders',
      'revolving-inferno',
      'forge-wave',
      'judgment-of-the-forge',
    ];
    expect(mechanicTextKeys(normal, difficultyMechanics)).toEqual({
      'brand-of-the-pyre': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.brandSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.brandResponse',
      },
      'searing-torrent': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.searingTorrentSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.searingTorrentResponse',
      },
      'rain-of-cinders': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.rainSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.rainResponse',
      },
      'revolving-inferno': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.raysSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.raysResponse',
      },
      'forge-wave': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.forgeWaveSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.forgeWaveResponse',
      },
      'judgment-of-the-forge': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.judgmentSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.judgmentResponse',
      },
    });
    expect(mechanicTextKeys(heroic, difficultyMechanics)).toEqual({
      'brand-of-the-pyre': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.brandSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.brandHeroicResponse',
      },
      'searing-torrent': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.searingTorrentHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.searingTorrentResponse',
      },
      'rain-of-cinders': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.rainHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.rainResponse',
      },
      'revolving-inferno': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.raysHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.raysResponse',
      },
      'forge-wave': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.forgeWaveHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.forgeWaveResponse',
      },
      'judgment-of-the-forge': {
        summaryKey: 'hudChrome.raidBossGuide.ignivar.judgmentHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.ignivar.judgmentResponse',
      },
    });
  });

  it('pins every Varkhul Normal and Heroic text-key branch to its mechanic', () => {
    const normal = raidBossGuideView('varkhul', 'normal');
    const heroic = raidBossGuideView('varkhul', 'heroic');
    const difficultyMechanics = [
      'forgefather-frontal',
      'cinder-orbs',
      'shared-pyre',
      'forgestorm',
      'anvils-decree',
      'crucible-beam',
      'masterpiece-unbound',
    ];

    expect(normal.phases.find((phase) => phase.id === 'finale')?.summaryKey).toBe(
      'hudChrome.raidBossGuide.varkhul.phaseFinaleSummary',
    );
    expect(heroic.phases.find((phase) => phase.id === 'finale')?.summaryKey).toBe(
      'hudChrome.raidBossGuide.varkhul.phaseFinaleHeroicSummary',
    );
    expect(
      normal.phases.flatMap((phase) => phase.mechanics).some(({ id }) => id === 'worldfire'),
    ).toBe(false);
    expect(
      heroic.phases.flatMap((phase) => phase.mechanics).some(({ id }) => id === 'worldfire'),
    ).toBe(true);
    expect(mechanicTextKeys(normal, difficultyMechanics)).toEqual({
      'forgefather-frontal': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.frontalSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.frontalResponse',
      },
      'cinder-orbs': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.orbsSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.orbsResponse',
      },
      'shared-pyre': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.pyreSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.pyreResponse',
      },
      forgestorm: {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.forgestormSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.forgestormResponse',
      },
      'anvils-decree': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.anvilSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.anvilResponse',
      },
      'crucible-beam': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.beamSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.beamResponse',
      },
      'masterpiece-unbound': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.masterpieceSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.masterpieceResponse',
      },
    });
    expect(mechanicTextKeys(heroic, difficultyMechanics)).toEqual({
      'forgefather-frontal': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.frontalHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.frontalResponse',
      },
      'cinder-orbs': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.orbsHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.orbsResponse',
      },
      'shared-pyre': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.pyreHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.pyreResponse',
      },
      forgestorm: {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.forgestormHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.forgestormResponse',
      },
      'anvils-decree': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.anvilHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.anvilHeroicResponse',
      },
      'crucible-beam': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.beamHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.beamResponse',
      },
      'masterpiece-unbound': {
        summaryKey: 'hudChrome.raidBossGuide.varkhul.masterpieceHeroicSummary',
        responseKey: 'hudChrome.raidBossGuide.varkhul.masterpieceResponse',
      },
    });
  });

  it('covers Varkhul tanking, soaks, forge adds, beam blocking, and the final phase', () => {
    const view = raidBossGuideView('varkhul', 'heroic');
    const mechanics = view.phases.flatMap((phase) => phase.mechanics);

    expect(view.bossId).toBe('varkhul_forgefather_of_the_last_flame');
    expect(view.portraitUrl).toBe('/ui/mobs/varkhul_forgefather_of_the_last_flame.webp');
    expect(view.phases.map((phase) => phase.id)).toEqual(['opening', 'assembly', 'finale']);
    expect(mechanics.map((mechanic) => mechanic.id)).toEqual([
      'makers-brand',
      'forgefather-frontal',
      'cinder-orbs',
      'shared-pyre',
      'forgestorm',
      'tempering-ray',
      'anvils-decree',
      'masters-assembly',
      'crucible-beam',
      'forge-legion',
      'masterpiece-unbound',
      'worldfire',
    ]);
    expect(mechanics.find((mechanic) => mechanic.id === 'makers-brand')?.values).toEqual({
      stacks: VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS,
    });
    expect(mechanics.find((mechanic) => mechanic.id === 'shared-pyre')?.values).toEqual({
      players: VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
      missingPenalty: VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
    });
    expect(mechanics.find((mechanic) => mechanic.id === 'shared-pyre')?.percentValues).toEqual([
      'missingPenalty',
    ]);
    expect(mechanics.find((mechanic) => mechanic.id === 'forge-legion')?.flags).toEqual([
      'interruptible',
      'important',
    ]);
    expect(view.phases.find((phase) => phase.id === 'assembly')?.values).toEqual({
      health: VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD,
    });
    expect(view.phases.find((phase) => phase.id === 'finale')?.values).toEqual({
      health: VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD,
    });
    expect(mechanics.find((mechanic) => mechanic.id === 'forgestorm')?.values).toEqual({
      waves: VARKHUL_FORGESTORM_WAVES,
    });
    expect(mechanics.find((mechanic) => mechanic.id === 'anvils-decree')?.values).toEqual({
      strikes: VARKHUL_ANVILS_DECREE_STRIKES,
    });
  });

  it('sources every phase threshold from the simulation contract', () => {
    const source = readFileSync(
      new URL('../src/ui/raid_boss_guide_view.ts', import.meta.url),
      'utf8',
    );

    for (const constant of [
      'IGNIVAR_APOCALYPSE_HP_THRESHOLD',
      'IGNIVAR_JUDGMENT_HP_THRESHOLD',
      'IGNIVAR_LAST_INFERNO_HP_THRESHOLD',
      'VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD',
      'VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD',
      'NYTHRAXIS_PHASE_TWO_HP',
    ]) {
      expect(source).toContain(`values: { health: ${constant} }`);
    }
    expect(source).toContain('health: NYTHRAXIS_PHASE_THREE_HP');
  });

  it('gives every journal mechanic a deliberate and visually distinct ability icon', () => {
    const iconIds = [
      ...new Set(
        (['ignivar', 'varkhul', 'nythraxis'] as const).flatMap((boss) =>
          raidBossGuideView(boss, 'heroic').phases.flatMap((phase) =>
            phase.mechanics.map((mechanic) => mechanic.iconId),
          ),
        ),
      ),
    ];
    const recipes = iconIds.map((iconId) => abilityIconRecipe(iconId));

    expect(recipes.every((recipe) => !isUnknownIconRecipe(recipe))).toBe(true);
    expect(new Set(recipes.map((recipe) => JSON.stringify(recipe))).size).toBe(iconIds.length);
  });
});
