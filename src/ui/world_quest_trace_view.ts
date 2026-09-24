import type {
  WorldQuestDef,
  WorldQuestProgress,
  WorldQuestTraceDef,
  WorldQuestTraceResult,
  WorldQuestTraceState,
} from '../sim/types';
import { worldQuestTraceShape } from '../sim/world_quest_trace_variants';
import { formatNumber, t } from './i18n';

export function worldQuestTraceShapeName(kind: WorldQuestTraceDef['kind']): string {
  return t(`questUi.worldQuest.traceShape.${kind}`);
}

export function worldQuestTraceRatingLabel(rating: WorldQuestTraceResult['rating']): string {
  return t(`questUi.worldQuest.traceRating.${rating}`);
}

/** The public score is cosmetic; the completion reward is never rated. */
export function worldQuestTraceScoreText(
  result: Pick<WorldQuestTraceResult, 'score' | 'rating'>,
): string {
  return t('questUi.worldQuest.traceScoreResult', {
    rating: worldQuestTraceRatingLabel(result.rating),
    score: formatNumber(result.score, { maximumFractionDigits: 0 }),
    total: formatNumber(100, { maximumFractionDigits: 0 }),
  });
}

/** Local-owner progress only. Public nearby ink never enters this projection. */
export function worldQuestTraceProgressInstruction(
  progress: WorldQuestProgress,
  quest: WorldQuestDef,
): string {
  if (progress.state === 'completed' && progress.traceResult)
    return worldQuestTraceScoreText(progress.traceResult);
  if (quest.objective.type !== 'tracing') return '';
  const index = progress.tracing?.shapeIndex ?? progress.count;
  const shape = worldQuestTraceShape(quest, index, progress.traceVariant);
  if (!shape) return t('questUi.worldQuest.traceUnavailable');
  return worldQuestTraceRoundInstruction(
    progress.tracing,
    quest.objective.shapes,
    progress.count,
    shape.kind,
  );
}

/** Exact authored NPC reactions; player chat is excluded by the caller's guard. */
export function localizeWorldQuestTraceReaction(text: string): string | null {
  switch (text) {
    case 'Three corners, and every one in its place!':
      return t('questUi.worldQuest.traceReaction.tessaTriangle');
    case 'Four sides! I think I can do that too!':
      return t('questUi.worldQuest.traceReaction.pipSquare');
    case 'Final rune. A line may cross or revisit a point; follow the bright marker to the next corner.':
      return t('questUi.worldQuest.traceReaction.elianFinal');
    case 'Beautifully traced! Your steps have earned their place in gold.':
      return t('questUi.worldQuest.traceReaction.elianGold');
    case 'A complete rune! Care and practice will make your next one even finer.':
      return t('questUi.worldQuest.traceReaction.elianComplete');
    default:
      return null;
  }
}

/** Round and shape come from the authoritative session, or saved completed rounds. */
export function worldQuestTraceRoundInstruction(
  trace: WorldQuestTraceState | undefined,
  shapes: readonly WorldQuestTraceDef[],
  completedRounds = 0,
  selectedKind?: WorldQuestTraceDef['kind'],
): string {
  const requested = trace?.shapeIndex ?? completedRounds;
  const index = Number.isInteger(requested)
    ? Math.max(0, Math.min(shapes.length - 1, requested))
    : 0;
  const shape = shapes[index];
  const instruction = worldQuestTraceInstruction(trace);
  if (!shape) return instruction;
  return t('questUi.worldQuest.traceRoundInstruction', {
    round: formatNumber(index + 1, { maximumFractionDigits: 0 }),
    total: formatNumber(shapes.length, { maximumFractionDigits: 0 }),
    shape: worldQuestTraceShapeName(selectedKind ?? shape.kind),
    instruction,
  });
}

/** Movement instructions follow authoritative phases, not a local countdown. */
export function worldQuestTraceInstruction(trace: WorldQuestTraceState | undefined): string {
  if (!trace) return t('questUi.worldQuest.traceReady');
  if (trace.phase === 'preview') return t('questUi.worldQuest.tracePreview');
  if (trace.phase === 'success') return t('questUi.worldQuest.traceSuccess');
  if (trace.phase === 'drawing') {
    return t(trace.started ? 'questUi.worldQuest.traceDrawing' : 'questUi.worldQuest.traceStart');
  }
  switch (trace.reason) {
    case 'off-path':
      return t('questUi.worldQuest.traceOffPath');
    case 'movement':
      return t('questUi.worldQuest.traceMovement');
    case 'timeout':
      return t('questUi.worldQuest.traceTimeout');
    case 'combat':
      return t('questUi.worldQuest.traceCombat');
    default:
      return t('questUi.worldQuest.traceRetry');
  }
}
