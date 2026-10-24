// Pure encounter-journal core shared by the raid guide and the five-player
// dungeon guides. A journal SOURCE lists its bosses in route order and builds
// one boss page per difficulty; the window (raid_boss_guide_window.ts) paints
// whatever source the room context or the Dungeon Finder hands it. The raid
// source wraps raid_boss_guide_view.ts unchanged; each dungeon is one
// data-as-code module under ./dungeons/ whose numbers come from the sim's own
// tuning (never retyped), resolved per difficulty here.

import type { DungeonDifficulty } from '../../sim/types';
import type { TranslationKey } from '../i18n';
import {
  type RaidBossGuideBoss,
  raidBossGuideBossForDungeon,
  raidBossGuideView,
} from '../raid_boss_guide_view';
import { targetPortraitUrl } from '../target_portrait_view';

export type JournalDifficulty = 'normal' | 'heroic';
export type JournalRole = 'tank' | 'healer' | 'damage' | 'all';
export type JournalFlag = 'deadly' | 'interruptible' | 'important' | 'cleansable';
/** How a mechanic differs between the tiers, shown on the Heroic tab only. */
export type JournalMark = 'heroicOnly' | 'heroicChanged';
export type JournalRank = 'boss' | 'miniboss' | 'final';
export type JournalTipRole = Exclude<JournalRole, 'all'>;
export type JournalValues = Readonly<Record<string, number>>;

/** A key, or one key per difficulty. */
export type JournalText = TranslationKey | Readonly<Record<JournalDifficulty, TranslationKey>>;

/** One damage range per difficulty: the window prints both side by side. */
export interface JournalDamageCompare {
  normal: { min: number; max: number };
  heroic: { min: number; max: number };
}

export interface JournalMechanic {
  id: string;
  iconId: string;
  nameKey: TranslationKey;
  summaryKey: TranslationKey;
  responseKey: TranslationKey;
  roles: readonly JournalRole[];
  flags: readonly JournalFlag[];
  values?: JournalValues;
  percentValues?: readonly string[];
  marks?: readonly JournalMark[];
  compare?: JournalDamageCompare;
}

export interface JournalPhase {
  id: string;
  nameKey: TranslationKey;
  summaryKey: TranslationKey;
  values?: JournalValues;
  percentValues?: readonly string[];
  mechanics: readonly JournalMechanic[];
}

export interface JournalTip {
  role: JournalTipRole;
  key: TranslationKey;
  values?: JournalValues;
  percentValues?: readonly string[];
}

/** A fight decision stated as a trade-off: what the group gains, what it risks. */
export interface JournalChoice {
  id: string;
  iconId: string;
  nameKey: TranslationKey;
  gainKey: TranslationKey;
  riskKey: TranslationKey;
  values?: JournalValues;
  percentValues?: readonly string[];
}

export interface JournalNote {
  key: TranslationKey;
  values?: JournalValues;
  percentValues?: readonly string[];
}

export interface JournalBossView {
  /** The boss's key inside its source (the raid's boss slug, a dungeon's mob id). */
  key: string;
  /** The mob template id: the boss's name, portrait, and finder row. */
  mobId: string;
  difficulty: JournalDifficulty;
  portraitUrl: string;
  overviewKey: TranslationKey;
  overviewValues?: JournalValues;
  overviewPercentValues?: readonly string[];
  phases: readonly JournalPhase[];
  rank?: JournalRank;
  tips?: readonly JournalTip[];
  choices?: readonly JournalChoice[];
  /** What changes on Heroic, shown as a callout on the Heroic tab. */
  heroicNotes?: readonly JournalNote[];
}

export interface JournalSource {
  /** 'raid', or the dungeon id. */
  id: string;
  kind: 'raid' | 'dungeon';
  bossKeys: readonly string[];
  view(bossKey: string, difficulty: JournalDifficulty): JournalBossView;
}

// ---- dungeon journal definitions (data modules under ./dungeons/) --------------

export interface JournalMechanicDef {
  id: string;
  iconId: string;
  nameKey: TranslationKey;
  summaryKey: JournalText;
  responseKey: JournalText;
  roles: readonly JournalRole[];
  flags?: readonly JournalFlag[];
  /** A heroic-only mechanic (never rendered on Normal). */
  availability?: 'heroic';
  /** The sim cast id behind the mechanic's cast bar, when it has one: the
   *  tests cross-check it against the sim (cast name, interruptibility). */
  castId?: string;
  values?: JournalValues;
  /** Merged over `values` for one difficulty (damage, cadence per tier). */
  difficultyValues?: Readonly<Record<JournalDifficulty, JournalValues>>;
  percentValues?: readonly string[];
  /** Print both tiers' range (from `difficultyValues[tier].min/max`). */
  compare?: boolean;
}

export interface JournalPhaseDef {
  id: string;
  nameKey: TranslationKey;
  summaryKey: JournalText;
  values?: JournalValues;
  percentValues?: readonly string[];
  mechanics: readonly JournalMechanicDef[];
}

export interface JournalChoiceDef {
  id: string;
  iconId: string;
  nameKey: TranslationKey;
  gainKey: JournalText;
  riskKey: JournalText;
  values?: JournalValues;
  percentValues?: readonly string[];
}

export interface JournalBossDef {
  mobId: string;
  rank: JournalRank;
  overviewKey: JournalText;
  overviewValues?: JournalValues;
  overviewPercentValues?: readonly string[];
  phases: readonly JournalPhaseDef[];
  tips: Readonly<Record<JournalTipRole, JournalText>>;
  tipValues?: JournalValues;
  tipPercentValues?: readonly string[];
  choices?: readonly JournalChoiceDef[];
  heroicNotes: readonly TranslationKey[];
  heroicNoteValues?: JournalValues;
  heroicNotePercentValues?: readonly string[];
}

export interface DungeonJournalDef {
  dungeonId: string;
  bosses: readonly JournalBossDef[];
}

const TIP_ROLES: readonly JournalTipRole[] = ['tank', 'healer', 'damage'];

function pick(value: JournalText, difficulty: JournalDifficulty): TranslationKey {
  return typeof value === 'string' ? value : value[difficulty];
}

function sameValues(a: JournalValues | undefined, b: JournalValues | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a?.[k] === b?.[k]);
}

/** Whether a mechanic reads differently on Heroic: its own heroic text, or a
 *  number that moves between the tiers. */
export function mechanicChangesOnHeroic(def: JournalMechanicDef): boolean {
  if (def.availability === 'heroic') return false;
  if (typeof def.summaryKey !== 'string' || typeof def.responseKey !== 'string') return true;
  if (!def.difficultyValues) return false;
  return !sameValues(def.difficultyValues.normal, def.difficultyValues.heroic);
}

function mechanicValues(
  def: JournalMechanicDef,
  difficulty: JournalDifficulty,
): JournalValues | undefined {
  const tier = def.difficultyValues?.[difficulty];
  if (!def.values && !tier) return undefined;
  return { ...(def.values ?? {}), ...(tier ?? {}) };
}

function damageCompare(def: JournalMechanicDef): JournalDamageCompare | undefined {
  if (!def.compare || !def.difficultyValues) return undefined;
  const n = def.difficultyValues.normal;
  const h = def.difficultyValues.heroic;
  if (n.min === undefined || n.max === undefined || h.min === undefined || h.max === undefined) {
    return undefined;
  }
  return { normal: { min: n.min, max: n.max }, heroic: { min: h.min, max: h.max } };
}

/** The phases one difficulty shows: heroic-only mechanics drop on Normal, and
 *  on Heroic every mechanic carries its tier mark. */
export function buildJournalPhases(
  defs: readonly JournalPhaseDef[],
  difficulty: JournalDifficulty,
): JournalPhase[] {
  return defs
    .map((phase) => ({
      id: phase.id,
      nameKey: phase.nameKey,
      summaryKey: pick(phase.summaryKey, difficulty),
      ...(phase.values ? { values: phase.values } : {}),
      ...(phase.percentValues ? { percentValues: phase.percentValues } : {}),
      mechanics: phase.mechanics
        .filter((m) => !m.availability || m.availability === difficulty)
        .map((m): JournalMechanic => {
          const values = mechanicValues(m, difficulty);
          const compare = damageCompare(m);
          const marks: JournalMark[] = [];
          if (difficulty === 'heroic') {
            if (m.availability === 'heroic') marks.push('heroicOnly');
            else if (mechanicChangesOnHeroic(m)) marks.push('heroicChanged');
          }
          return {
            id: m.id,
            iconId: m.iconId,
            nameKey: m.nameKey,
            summaryKey: pick(m.summaryKey, difficulty),
            responseKey: pick(m.responseKey, difficulty),
            roles: m.roles,
            flags: m.flags ?? [],
            ...(values ? { values } : {}),
            ...(m.percentValues ? { percentValues: m.percentValues } : {}),
            ...(marks.length > 0 ? { marks } : {}),
            ...(compare ? { compare } : {}),
          };
        }),
    }))
    .filter((phase) => phase.mechanics.length > 0);
}

/** One boss page of a dungeon journal. */
export function dungeonJournalBossView(
  boss: JournalBossDef,
  difficulty: JournalDifficulty,
): JournalBossView {
  return {
    key: boss.mobId,
    mobId: boss.mobId,
    difficulty,
    portraitUrl: targetPortraitUrl(boss.mobId, true) ?? '',
    overviewKey: pick(boss.overviewKey, difficulty),
    ...(boss.overviewValues ? { overviewValues: boss.overviewValues } : {}),
    ...(boss.overviewPercentValues ? { overviewPercentValues: boss.overviewPercentValues } : {}),
    phases: buildJournalPhases(boss.phases, difficulty),
    rank: boss.rank,
    tips: TIP_ROLES.map((role) => ({
      role,
      key: pick(boss.tips[role], difficulty),
      ...(boss.tipValues ? { values: boss.tipValues } : {}),
      ...(boss.tipPercentValues ? { percentValues: boss.tipPercentValues } : {}),
    })),
    choices: (boss.choices ?? []).map((choice) => ({
      id: choice.id,
      iconId: choice.iconId,
      nameKey: choice.nameKey,
      gainKey: pick(choice.gainKey, difficulty),
      riskKey: pick(choice.riskKey, difficulty),
      ...(choice.values ? { values: choice.values } : {}),
      ...(choice.percentValues ? { percentValues: choice.percentValues } : {}),
    })),
    heroicNotes:
      difficulty === 'heroic'
        ? boss.heroicNotes.map((key) => ({
            key,
            ...(boss.heroicNoteValues ? { values: boss.heroicNoteValues } : {}),
            ...(boss.heroicNotePercentValues
              ? { percentValues: boss.heroicNotePercentValues }
              : {}),
          }))
        : [],
  };
}

/** A dungeon journal as a window source. */
export function dungeonJournalSource(def: DungeonJournalDef): JournalSource {
  const byKey = new Map(def.bosses.map((boss) => [boss.mobId, boss]));
  return {
    id: def.dungeonId,
    kind: 'dungeon',
    bossKeys: def.bosses.map((boss) => boss.mobId),
    view(bossKey, difficulty) {
      const boss = byKey.get(bossKey) ?? def.bosses[0];
      return dungeonJournalBossView(boss, difficulty);
    },
  };
}

// ---- the raid source -------------------------------------------------------------

const RAID_BOSSES: readonly RaidBossGuideBoss[] = ['ignivar', 'varkhul', 'nythraxis'];

/** The raid guide as a window source: raid_boss_guide_view.ts, unchanged. */
export const RAID_JOURNAL_SOURCE: JournalSource = {
  id: 'raid',
  kind: 'raid',
  bossKeys: RAID_BOSSES,
  view(bossKey, difficulty) {
    const boss = (RAID_BOSSES as readonly string[]).includes(bossKey)
      ? (bossKey as RaidBossGuideBoss)
      : RAID_BOSSES[0];
    const view = raidBossGuideView(boss, difficulty);
    return {
      key: boss,
      mobId: view.bossId,
      difficulty,
      portraitUrl: view.portraitUrl,
      overviewKey: view.overviewKey as TranslationKey,
      phases: view.phases.map((phase) => ({
        ...phase,
        nameKey: phase.nameKey as TranslationKey,
        summaryKey: phase.summaryKey as TranslationKey,
        mechanics: phase.mechanics.map((mechanic) => ({
          ...mechanic,
          nameKey: mechanic.nameKey as TranslationKey,
          summaryKey: mechanic.summaryKey as TranslationKey,
          responseKey: mechanic.responseKey as TranslationKey,
        })),
      })),
    };
  },
};

// ---- room context ------------------------------------------------------------------

/** The run the local player stands in, as IWorld.dungeonRun reports it. */
export interface JournalRunInput {
  dungeonId: string;
  difficulty: DungeonDifficulty;
  bosses: readonly { mobId: string; defeated: boolean }[];
}

export interface JournalContext {
  source: JournalSource;
  /** The boss the room suggests: the raid room's boss, or a dungeon's next
   *  undefeated boss in the run (its first boss with no run). */
  bossKey: string;
  /** The run's difficulty when the run is this journal's dungeon. */
  runDifficulty: JournalDifficulty | null;
}

/** Whether a journal boss is down in the run (a boss with no run row is never). */
export function journalBossDefeated(run: JournalRunInput | null, mobId: string): boolean {
  return run?.bosses.some((row) => row.mobId === mobId && row.defeated) ?? false;
}

/** The first boss in route order still standing. A miniboss the run does not
 *  track (no run row) counts as passed once any later tracked boss is down. */
export function nextJournalBoss(
  bossKeys: readonly string[],
  run: JournalRunInput,
): string | undefined {
  const tracked = (key: string) => run.bosses.some((row) => row.mobId === key);
  return bossKeys.find((key, index) => {
    if (tracked(key)) return !journalBossDefeated(run, key);
    return !bossKeys.slice(index + 1).some((later) => journalBossDefeated(run, later));
  });
}

/** The journal a room offers, from a dungeon-source lookup the caller supplies
 *  (so this core stays free of the per-dungeon data). */
export function journalContextFor(
  dungeonId: string | null,
  run: JournalRunInput | null,
  dungeonSource: (dungeonId: string) => JournalSource | null,
): JournalContext | null {
  const raidBoss = raidBossGuideBossForDungeon(dungeonId);
  if (raidBoss) return { source: RAID_JOURNAL_SOURCE, bossKey: raidBoss, runDifficulty: null };
  if (!dungeonId) return null;
  const source = dungeonSource(dungeonId);
  if (!source || source.bossKeys.length === 0) return null;
  const ownRun = run && run.dungeonId === dungeonId ? run : null;
  const next = ownRun ? nextJournalBoss(source.bossKeys, ownRun) : undefined;
  return {
    source,
    bossKey: next ?? source.bossKeys[0],
    runDifficulty: ownRun ? (ownRun.difficulty === 'heroic' ? 'heroic' : 'normal') : null,
  };
}
