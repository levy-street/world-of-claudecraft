import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
} from '../src/sim/encounters/ignivar';
import {
  VARKHUL_FORGESTORM_WAVES,
  VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS,
  VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD,
  VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD,
} from '../src/sim/encounters/varkhul';
import { IGNIVAR_JUDGMENT_HP_THRESHOLD } from '../src/sim/ignivar_forge_judgment';
import { VARKHUL_ANVILS_DECREE_STRIKES } from '../src/sim/varkhul_anvils_decree';
import {
  VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
  VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
} from '../src/sim/varkhul_shared_pyre';
import { abilityIconRecipe, isUnknownIconRecipe } from '../src/ui/icons';
import { raidBossGuideBossForDungeon, raidBossGuideView } from '../src/ui/raid_boss_guide_view';

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
    ]) {
      expect(source).toContain(`values: { health: ${constant} }`);
    }
  });

  it('gives every journal mechanic a deliberate and visually distinct ability icon', () => {
    const iconIds = [
      ...new Set(
        (['ignivar', 'varkhul'] as const).flatMap((boss) =>
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
