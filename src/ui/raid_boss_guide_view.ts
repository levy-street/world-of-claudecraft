// Pure encounter-journal model for the raid guide reached from party frames.
// Room context selects the suggested boss, while the window may browse either
// encounter and choose Normal or Heroic without consulting mutable world state.

import {
  IGNIVAR_APOCALYPSE_HP_THRESHOLD,
  IGNIVAR_LAST_INFERNO_HP_THRESHOLD,
} from '../sim/encounters/ignivar';
import {
  VARKHUL_FORGESTORM_WAVES,
  VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS,
  VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD,
  VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD,
} from '../sim/encounters/varkhul';
import { IGNIVAR_JUDGMENT_HP_THRESHOLD } from '../sim/ignivar_forge_judgment';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  VARKHUL_BOSS_ID,
} from '../sim/ignivar_raid_ids';
import { IGNIVAR_BOSS_ID } from '../sim/types';
import { VARKHUL_ANVILS_DECREE_STRIKES } from '../sim/varkhul_anvils_decree';
import {
  VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
  VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
} from '../sim/varkhul_shared_pyre';
import { targetPortraitUrl } from './target_portrait_view';

export type RaidBossGuideBoss = 'ignivar' | 'varkhul';
export type RaidBossGuideDifficulty = 'normal' | 'heroic';
export type RaidBossGuideRole = 'tank' | 'healer' | 'damage' | 'all';
export type RaidBossGuideFlag = 'deadly' | 'interruptible' | 'important' | 'cleansable';
export type RaidBossGuideTextKey = `hudChrome.raidBossGuide.${string}`;

export interface RaidBossGuideMechanic {
  id: string;
  iconId: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey: RaidBossGuideTextKey;
  responseKey: RaidBossGuideTextKey;
  roles: readonly RaidBossGuideRole[];
  flags: readonly RaidBossGuideFlag[];
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
}

export interface RaidBossGuidePhase {
  id: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey: RaidBossGuideTextKey;
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
  mechanics: readonly RaidBossGuideMechanic[];
}

export interface RaidBossGuideView {
  boss: RaidBossGuideBoss;
  bossId: typeof IGNIVAR_BOSS_ID | typeof VARKHUL_BOSS_ID;
  difficulty: RaidBossGuideDifficulty;
  portraitUrl: string;
  overviewKey: RaidBossGuideTextKey;
  phases: readonly RaidBossGuidePhase[];
}

interface MechanicDefinition {
  id: string;
  iconId: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey:
    | RaidBossGuideTextKey
    | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>;
  responseKey:
    | RaidBossGuideTextKey
    | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>;
  roles: readonly RaidBossGuideRole[];
  flags?: readonly RaidBossGuideFlag[];
  availability?: RaidBossGuideDifficulty;
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
}

interface PhaseDefinition {
  id: string;
  nameKey: RaidBossGuideTextKey;
  summaryKey:
    | RaidBossGuideTextKey
    | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>;
  values?: Readonly<Record<string, number>>;
  percentValues?: readonly string[];
  mechanics: readonly MechanicDefinition[];
}

const key = (suffix: string): RaidBossGuideTextKey => `hudChrome.raidBossGuide.${suffix}`;

const IGNIVAR_PHASES: readonly PhaseDefinition[] = [
  {
    id: 'opening',
    nameKey: key('ignivar.phaseOpeningName'),
    summaryKey: key('ignivar.phaseOpeningSummary'),
    mechanics: [
      {
        id: 'forge-strike',
        iconId: 'raid_ignivar_forge_strike',
        nameKey: key('ignivar.forgeStrikeName'),
        summaryKey: key('ignivar.forgeStrikeSummary'),
        responseKey: key('ignivar.forgeStrikeResponse'),
        roles: ['tank', 'healer'],
        flags: ['important'],
        values: { stacks: 2 },
      },
      {
        id: 'brand-of-the-pyre',
        iconId: 'raid_ignivar_brand',
        nameKey: key('ignivar.brandName'),
        summaryKey: key('ignivar.brandSummary'),
        responseKey: {
          normal: key('ignivar.brandResponse'),
          heroic: key('ignivar.brandHeroicResponse'),
        },
        roles: ['healer', 'damage'],
        flags: ['cleansable', 'important'],
      },
      {
        id: 'searing-torrent',
        iconId: 'raid_ignivar_searing_torrent',
        nameKey: key('ignivar.searingTorrentName'),
        summaryKey: {
          normal: key('ignivar.searingTorrentSummary'),
          heroic: key('ignivar.searingTorrentHeroicSummary'),
        },
        responseKey: key('ignivar.searingTorrentResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'rain-of-cinders',
        iconId: 'raid_ignivar_rain_of_cinders',
        nameKey: key('ignivar.rainName'),
        summaryKey: {
          normal: key('ignivar.rainSummary'),
          heroic: key('ignivar.rainHeroicSummary'),
        },
        responseKey: key('ignivar.rainResponse'),
        roles: ['all'],
        flags: ['deadly'],
      },
      {
        id: 'revolving-inferno',
        iconId: 'raid_ignivar_revolving_inferno',
        nameKey: key('ignivar.raysName'),
        summaryKey: {
          normal: key('ignivar.raysSummary'),
          heroic: key('ignivar.raysHeroicSummary'),
        },
        responseKey: key('ignivar.raysResponse'),
        roles: ['all'],
        flags: ['deadly'],
      },
      {
        id: 'forge-wave',
        iconId: 'raid_ignivar_forge_wave',
        nameKey: key('ignivar.forgeWaveName'),
        summaryKey: {
          normal: key('ignivar.forgeWaveSummary'),
          heroic: key('ignivar.forgeWaveHeroicSummary'),
        },
        responseKey: key('ignivar.forgeWaveResponse'),
        roles: ['all'],
        flags: ['important'],
      },
    ],
  },
  {
    id: 'apocalypse',
    nameKey: key('ignivar.phaseApocalypseName'),
    summaryKey: key('ignivar.phaseApocalypseSummary'),
    values: { health: IGNIVAR_APOCALYPSE_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'apocalypse',
        iconId: 'raid_ignivar_apocalypse',
        nameKey: key('ignivar.apocalypseName'),
        summaryKey: key('ignivar.apocalypseSummary'),
        responseKey: key('ignivar.apocalypseResponse'),
        roles: ['damage'],
        flags: ['deadly', 'important'],
      },
    ],
  },
  {
    id: 'judgment',
    nameKey: key('ignivar.phaseJudgmentName'),
    summaryKey: {
      normal: key('ignivar.phaseJudgmentSummary'),
      heroic: key('ignivar.phaseJudgmentHeroicSummary'),
    },
    values: { health: IGNIVAR_JUDGMENT_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'judgment-of-the-forge',
        iconId: 'raid_ignivar_judgment',
        nameKey: key('ignivar.judgmentName'),
        summaryKey: {
          normal: key('ignivar.judgmentSummary'),
          heroic: key('ignivar.judgmentHeroicSummary'),
        },
        responseKey: key('ignivar.judgmentResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'chains-of-the-forge',
        iconId: 'raid_ignivar_chains',
        nameKey: key('ignivar.chainsName'),
        summaryKey: key('ignivar.chainsSummary'),
        responseKey: key('ignivar.chainsResponse'),
        roles: ['all'],
        flags: ['important'],
        availability: 'heroic',
      },
    ],
  },
  {
    id: 'finale',
    nameKey: key('ignivar.phaseFinaleName'),
    summaryKey: key('ignivar.phaseFinaleSummary'),
    values: { health: IGNIVAR_LAST_INFERNO_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'last-inferno',
        iconId: 'raid_ignivar_last_inferno',
        nameKey: key('ignivar.lastInfernoName'),
        summaryKey: key('ignivar.lastInfernoSummary'),
        responseKey: key('ignivar.lastInfernoResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
    ],
  },
];

const VARKHUL_PHASES: readonly PhaseDefinition[] = [
  {
    id: 'opening',
    nameKey: key('varkhul.phaseOpeningName'),
    summaryKey: key('varkhul.phaseOpeningSummary'),
    mechanics: [
      {
        id: 'makers-brand',
        iconId: 'raid_varkhul_makers_brand',
        nameKey: key('varkhul.makersBrandName'),
        summaryKey: key('varkhul.makersBrandSummary'),
        responseKey: key('varkhul.makersBrandResponse'),
        roles: ['tank', 'healer'],
        flags: ['important'],
        values: { stacks: VARKHUL_MAKERS_BRAND_TANK_SWAP_STACKS },
      },
      {
        id: 'forgefather-frontal',
        iconId: 'raid_varkhul_frontal',
        nameKey: key('varkhul.frontalName'),
        summaryKey: {
          normal: key('varkhul.frontalSummary'),
          heroic: key('varkhul.frontalHeroicSummary'),
        },
        responseKey: key('varkhul.frontalResponse'),
        roles: ['all'],
        flags: ['deadly'],
      },
      {
        id: 'cinder-orbs',
        iconId: 'raid_varkhul_cinder_orbs',
        nameKey: key('varkhul.orbsName'),
        summaryKey: {
          normal: key('varkhul.orbsSummary'),
          heroic: key('varkhul.orbsHeroicSummary'),
        },
        responseKey: key('varkhul.orbsResponse'),
        roles: ['healer', 'damage'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'shared-pyre',
        iconId: 'raid_varkhul_shared_pyre',
        nameKey: key('varkhul.pyreName'),
        summaryKey: {
          normal: key('varkhul.pyreSummary'),
          heroic: key('varkhul.pyreHeroicSummary'),
        },
        responseKey: key('varkhul.pyreResponse'),
        roles: ['all'],
        flags: ['important'],
        values: {
          players: VARKHUL_SHARED_PYRE_REQUIRED_PLAYERS,
          missingPenalty: VARKHUL_SHARED_PYRE_RAID_DAMAGE_PER_MISSING,
        },
        percentValues: ['missingPenalty'],
      },
      {
        id: 'forgestorm',
        iconId: 'raid_varkhul_forgestorm',
        nameKey: key('varkhul.forgestormName'),
        summaryKey: {
          normal: key('varkhul.forgestormSummary'),
          heroic: key('varkhul.forgestormHeroicSummary'),
        },
        responseKey: key('varkhul.forgestormResponse'),
        roles: ['all'],
        flags: ['deadly'],
        values: { waves: VARKHUL_FORGESTORM_WAVES },
      },
      {
        id: 'tempering-ray',
        iconId: 'raid_varkhul_tempering_ray',
        nameKey: key('varkhul.rayName'),
        summaryKey: key('varkhul.raySummary'),
        responseKey: key('varkhul.rayResponse'),
        roles: ['tank', 'healer'],
        flags: ['important'],
      },
      {
        id: 'anvils-decree',
        iconId: 'raid_varkhul_anvils_decree',
        nameKey: key('varkhul.anvilName'),
        summaryKey: {
          normal: key('varkhul.anvilSummary'),
          heroic: key('varkhul.anvilHeroicSummary'),
        },
        responseKey: {
          normal: key('varkhul.anvilResponse'),
          heroic: key('varkhul.anvilHeroicResponse'),
        },
        roles: ['all'],
        flags: ['deadly', 'important'],
        values: { strikes: VARKHUL_ANVILS_DECREE_STRIKES },
      },
    ],
  },
  {
    id: 'assembly',
    nameKey: key('varkhul.phaseAssemblyName'),
    summaryKey: key('varkhul.phaseAssemblySummary'),
    values: { health: VARKHUL_MASTERS_ASSEMBLY_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'masters-assembly',
        iconId: 'raid_varkhul_masters_assembly',
        nameKey: key('varkhul.assemblyName'),
        summaryKey: key('varkhul.assemblySummary'),
        responseKey: key('varkhul.assemblyResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'crucible-beam',
        iconId: 'raid_varkhul_crucible_beam',
        nameKey: key('varkhul.beamName'),
        summaryKey: {
          normal: key('varkhul.beamSummary'),
          heroic: key('varkhul.beamHeroicSummary'),
        },
        responseKey: key('varkhul.beamResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'forge-legion',
        iconId: 'raid_varkhul_forge_legion',
        nameKey: key('varkhul.legionName'),
        summaryKey: key('varkhul.legionSummary'),
        responseKey: key('varkhul.legionResponse'),
        roles: ['damage'],
        flags: ['interruptible', 'important'],
      },
    ],
  },
  {
    id: 'finale',
    nameKey: key('varkhul.phaseFinaleName'),
    summaryKey: {
      normal: key('varkhul.phaseFinaleSummary'),
      heroic: key('varkhul.phaseFinaleHeroicSummary'),
    },
    values: { health: VARKHUL_MASTERPIECE_UNBOUND_HP_THRESHOLD },
    percentValues: ['health'],
    mechanics: [
      {
        id: 'masterpiece-unbound',
        iconId: 'raid_varkhul_masterpiece_unbound',
        nameKey: key('varkhul.masterpieceName'),
        summaryKey: {
          normal: key('varkhul.masterpieceSummary'),
          heroic: key('varkhul.masterpieceHeroicSummary'),
        },
        responseKey: key('varkhul.masterpieceResponse'),
        roles: ['all'],
        flags: ['deadly', 'important'],
      },
      {
        id: 'worldfire',
        iconId: 'raid_varkhul_worldfire',
        nameKey: key('varkhul.worldfireName'),
        summaryKey: key('varkhul.worldfireSummary'),
        responseKey: key('varkhul.worldfireResponse'),
        roles: ['all'],
        flags: ['deadly'],
        availability: 'heroic',
      },
    ],
  },
];

function localizedKey(
  value: RaidBossGuideTextKey | Readonly<Record<RaidBossGuideDifficulty, RaidBossGuideTextKey>>,
  difficulty: RaidBossGuideDifficulty,
): RaidBossGuideTextKey {
  return typeof value === 'string' ? value : value[difficulty];
}

function buildPhases(
  definitions: readonly PhaseDefinition[],
  difficulty: RaidBossGuideDifficulty,
): RaidBossGuidePhase[] {
  return definitions.map((phase) => ({
    id: phase.id,
    nameKey: phase.nameKey,
    summaryKey: localizedKey(phase.summaryKey, difficulty),
    ...(phase.values ? { values: phase.values } : {}),
    ...(phase.percentValues ? { percentValues: phase.percentValues } : {}),
    mechanics: phase.mechanics
      .filter((mechanic) => !mechanic.availability || mechanic.availability === difficulty)
      .map((mechanic) => ({
        id: mechanic.id,
        iconId: mechanic.iconId,
        nameKey: mechanic.nameKey,
        summaryKey: localizedKey(mechanic.summaryKey, difficulty),
        responseKey: localizedKey(mechanic.responseKey, difficulty),
        roles: mechanic.roles,
        flags: mechanic.flags ?? [],
        ...(mechanic.values ? { values: mechanic.values } : {}),
        ...(mechanic.percentValues ? { percentValues: mechanic.percentValues } : {}),
      })),
  }));
}

export function raidBossGuideBossForDungeon(dungeonId: string | null): RaidBossGuideBoss | null {
  if (dungeonId === IGNIVAR_FORGE_APPROACH_ID || dungeonId === IGNIVAR_RAID_ARENA_ID) {
    return 'ignivar';
  }
  if (dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID || dungeonId === IGNIVAR_SECOND_WING_ID) {
    return 'varkhul';
  }
  return null;
}

export function raidBossGuideView(
  boss: RaidBossGuideBoss,
  difficulty: RaidBossGuideDifficulty = 'normal',
): RaidBossGuideView {
  const bossId = boss === 'ignivar' ? IGNIVAR_BOSS_ID : VARKHUL_BOSS_ID;
  return {
    boss,
    bossId,
    difficulty,
    portraitUrl: targetPortraitUrl(bossId, true) ?? '',
    overviewKey: key(`${boss}.overview`),
    phases: buildPhases(boss === 'ignivar' ? IGNIVAR_PHASES : VARKHUL_PHASES, difficulty),
  };
}
