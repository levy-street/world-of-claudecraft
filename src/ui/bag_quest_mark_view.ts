// Pure, host-agnostic core for the bag grid's quest-purpose mark.
// Quest items are a PURPOSE class (kind === 'quest'), not a quality tier. The
// bag painter needs a single on/off (and ready/orphaned) decision so every
// quest stack can wear a quest-gold rim, soft wash, and corner seal without the
// painter re-deriving kind logic.
//
// Mark kinds:
//   'quest'           - active quest purpose (default rim + seal)
//   'questReady'      - whole quest ready to turn in (log state === 'ready')
//   'questOrphaned'   - reserved (not invented by this resolver yet)
//
// Ready is NEVER invented from kind alone or from partial collect progress:
// only the quest log's ready state means turn-in is available. Matching
// collect/gather rows still project for host diagnostics, but a multi-objective
// quest that is still active must not brighten the seal as if it were turn-in
// ready (tooltip progress covers per-item completion).
//
// The mark is information-ADD and pairs with an aria-hidden seal: the cell's
// accessible name carries the quest fact, and the treatment renders identically
// on every graphics preset (no --fx gate), so it never becomes a fairness lever.
//
// Glyph priority (composed by the painter with bag_instance_glyph_view):
//   masterwork > quest seal > enchanted / signed / bound > generic wedge.
// Rim and wash always apply for any non-null mark kind.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

export type BagQuestMarkKind = 'quest' | 'questReady' | 'questOrphaned' | null;

/** One collect/gather objective already filtered to this itemId. */
export interface BagQuestMarkObjectiveProgress {
  current: number;
  required: number;
}

/**
 * Plain progress inputs for the ready decision. Absent/null keeps default
 * on/off behavior ('quest' only). Ready is decided solely from `state ===
 * 'ready'`. Host may still project matching objectives for diagnostics; the
 * pure core never imports sim data tables.
 */
export interface BagQuestMarkProgressInput {
  /** Quest log state: active | ready | done | ... */
  state: string;
  /**
   * Matching collect/gather objectives for THIS item (diagnostic / future
   * use). Not used for the ready mark; only log state === 'ready' brightens.
   */
  matchingObjectives?: readonly BagQuestMarkObjectiveProgress[];
}

/** Objective row shape shared with the quest-item tooltip plain inputs. */
export interface BagQuestMarkObjectiveInput {
  type: string;
  itemId?: string;
  count: number;
}

/** Quest-log slice used to build progress without a full Sim. */
export interface BagQuestMarkLogInput {
  counts: readonly number[];
  state: string;
  resolvedCounts?: readonly number[];
}

/** The quest-purpose mark for one bag stack, or null when the item is not a
 *  quest kind. Without progress inputs, always returns 'quest' or null (never
 *  invents ready/orphaned from kind alone). */
export function bagQuestMarkKind(
  item: { kind: string },
  progress?: BagQuestMarkProgressInput | null,
): BagQuestMarkKind {
  if (item.kind !== 'quest') return null;
  if (isQuestReady(progress)) return 'questReady';
  return 'quest';
}

/**
 * Project plain log + objectives into the progress input bagQuestMarkKind
 * consumes. Returns null when the player does not hold the quest (no log, or
 * state is neither active nor ready), so the painter falls back to the default
 * quest mark without inventing ready.
 */
export function bagQuestMarkProgressFromLog(
  itemId: string,
  log: BagQuestMarkLogInput | null | undefined,
  objectives?: readonly BagQuestMarkObjectiveInput[] | null,
): BagQuestMarkProgressInput | null {
  if (!log) return null;
  if (log.state !== 'active' && log.state !== 'ready') return null;

  const matching: BagQuestMarkObjectiveProgress[] = [];
  if (objectives) {
    for (let i = 0; i < objectives.length; i++) {
      const objective = objectives[i];
      if (!isCollectOrGatherWithItem(objective, itemId)) continue;
      const required = log.resolvedCounts?.[i] ?? objective.count;
      const current = log.counts[i] ?? 0;
      matching.push({ current, required });
    }
  }
  return { state: log.state, matchingObjectives: matching };
}

function isCollectOrGatherWithItem(objective: BagQuestMarkObjectiveInput, itemId: string): boolean {
  if (objective.itemId !== itemId) return false;
  return objective.type === 'collect' || objective.type === 'gather';
}

function isQuestReady(progress?: BagQuestMarkProgressInput | null): boolean {
  if (!progress) return false;
  // Whole-quest ready only: turn-in available. Partial item-objective completion
  // while state is still active must stay on the default quest mark.
  return progress.state === 'ready';
}
