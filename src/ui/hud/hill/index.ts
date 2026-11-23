// HUD domain: King of the Hill. The bar the HUD composes while the local
// player stands in the standing hill's zone (see CLAUDE.md here).

export type { HillBarDeps } from './hill_bar_painter';
export { HillBar, hillCalloutText } from './hill_bar_painter';
export type { HillBarLive, HillBarView } from './hill_bar_view';
export {
  buildHillBarView,
  hillCalloutToShow,
  hillEdgeDistance,
  hillRivalCount,
  shouldAnnounceHillPvp,
} from './hill_bar_view';
