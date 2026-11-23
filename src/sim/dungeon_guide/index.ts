// The dungeon guide system's public surface (see guide.ts and ./CLAUDE.md).
export { answerDungeonGuide, freshGuideRun, GUIDE_ANSWER_RANGE, tickDungeonGuides } from './guide';
export type {
  DungeonGuideDef,
  DungeonGuideRun,
  GuideLineDef,
  GuideLinePriority,
  GuideTrigger,
} from './types';
