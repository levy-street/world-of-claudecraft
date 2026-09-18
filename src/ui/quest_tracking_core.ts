// Which of the player's accepted quests this CLIENT is watching: the local
// tracking set behind the atlas rail's Untrack control, the world map's gold
// objective badges, and the on-screen quest tracker.
//
// PRESENTATION STATE ONLY. Untracking never touches the sim's quest log (that is
// Abandon, an authoritative command with rewards and credit behind it): the quest
// stays accepted, keeps earning credit, and keeps its acceptance-order number. The
// set stored here is the EXCLUSION list, so a quest accepted later is tracked by
// default and a corrupt or missing row degrades to "everything is tracked".
//
// Per character, like the Book of Deeds watch list: the key carries the class and
// the character name, so two characters on one browser never inherit each other's
// choices. Storage goes through safeLocalStorage(), so a locked-down browser keeps
// the whole feature working in-session and simply forgets it on reload.

import { safeLocalStorage } from './safe_local_storage';

/** Prefix of the per-character localStorage row. */
export const QUEST_UNTRACK_KEY_PREFIX = 'woc_untracked_quests';

/** The persisted row's key for one character. */
export function questUntrackStorageKey(playerClass: string, playerName: string): string {
  return `${QUEST_UNTRACK_KEY_PREFIX}_${playerClass}_${playerName}`;
}

/** Parse a stored row into an id set. Anything that is not an array of strings
 *  (absent, corrupt, an older shape) reads as "nothing untracked". */
export function parseUntrackedQuestIds(raw: string | null): Set<string> {
  const ids = new Set<string>();
  if (raw === null) return ids;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ids;
    for (const id of parsed) if (typeof id === 'string' && id !== '') ids.add(id);
  } catch {
    /* corrupt row: start fully tracked */
  }
  return ids;
}

/** Serialize an id set for storage (sorted, so an unchanged set is byte-stable). */
export function serializeUntrackedQuestIds(ids: Iterable<string>): string {
  return JSON.stringify([...ids].sort());
}

/**
 * The live tracking set for the character currently in play.
 *
 * `revision()` is the change counter every consumer with a repaint signature folds
 * in: the set is not part of any world snapshot, so nothing else in a rail's or a
 * tracker's signature can move when the player untracks a quest.
 */
export class QuestTrackingState {
  private key = '';
  private untracked = new Set<string>();
  private rev = 0;
  private playerClass = '';
  private playerName = '';

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage(),
  ) {}

  /**
   * Point the set at a character, loading its row on the first call and on every
   * switch. The two identity fields are compared BEFORE the key is composed: this
   * runs from the quest tracker's per-frame update, so composing a template string
   * per frame would be a per-frame allocation for a value that almost never moves.
   */
  useCharacter(playerClass: string, playerName: string): void {
    if (this.key !== '' && playerClass === this.playerClass && playerName === this.playerName) {
      return;
    }
    this.playerClass = playerClass;
    this.playerName = playerName;
    this.key = questUntrackStorageKey(playerClass, playerName);
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch {
      /* storage unavailable: start fully tracked */
    }
    this.untracked = parseUntrackedQuestIds(raw);
    this.rev++;
  }

  /** The untracked ids, live: consumers read it per build and never retain it. */
  untrackedIds(): ReadonlySet<string> {
    return this.untracked;
  }

  isTracked(questId: string): boolean {
    return !this.untracked.has(questId);
  }

  /** Track or untrack one quest. A no-op change never bumps the revision, so an
   *  idle repaint signature stays put. */
  setTracked(questId: string, tracked: boolean): void {
    if (tracked === this.isTracked(questId)) return;
    if (tracked) this.untracked.delete(questId);
    else this.untracked.add(questId);
    this.rev++;
    this.persist();
  }

  revision(): number {
    return this.rev;
  }

  private persist(): void {
    if (this.key === '') return;
    try {
      this.storage?.setItem(this.key, serializeUntrackedQuestIds(this.untracked));
    } catch {
      /* storage unavailable (private mode): the choice still holds in-session */
    }
  }
}

let shared: QuestTrackingState | null = null;

/** The one instance every HUD surface reads. Tests build their own
 *  `QuestTrackingState` over a fake storage rather than reaching for this. */
export function sharedQuestTracking(): QuestTrackingState {
  shared ??= new QuestTrackingState();
  return shared;
}
