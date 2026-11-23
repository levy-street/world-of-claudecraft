// Public surface of the encounter-journal subsystem (see ./CLAUDE.md).
export { journalModelFor } from './journal_model_spec';
export type {
  DungeonJournalDef,
  JournalBossView,
  JournalContext,
  JournalDifficulty,
  JournalRunInput,
  JournalSource,
} from './journal_view';
export { journalContextFor, RAID_JOURNAL_SOURCE } from './journal_view';
export { DUNGEON_JOURNALS, dungeonJournalSourceFor } from './registry';
