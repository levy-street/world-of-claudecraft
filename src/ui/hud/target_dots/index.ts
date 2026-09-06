// Public surface of the Target dots HUD domain: the pure selection core and its
// painter. The Hud composes these two and owns the container id.

export { TargetDotsPainter, type TargetDotsPainterDeps } from './target_dots_painter';
export {
  createTargetDotsView,
  TARGET_DOTS_DECIMAL_BELOW_SEC,
  TARGET_DOTS_ROW_CAP,
  type TargetDotRow,
  type TargetDotsAuraInput,
  type TargetDotsDeps,
  type TargetDotsEntityInput,
  type TargetDotsInput,
  type TargetDotsState,
  type TargetDotsViewCore,
} from './target_dots_view';
