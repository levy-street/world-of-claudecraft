// Pure i18n text for the low-tier buff-cap overflow badge (auras_painter.ts): the "+N"
// label and its native-tooltip explanation shown when auraVisibleCap
// (src/game/ui_tier_knobs.ts) has shed N cosmetic buff icons past the low-tier cap
// (docs/design/graphics-settings-fairness.md: hiding a buff ICON removes no actionable
// information, the aura stays active either way).
//
// Kept as its own tiny module rather than inlined in hud.ts (which is at its
// monolith_budget.test.ts line ceiling with no headroom to spare) or injected through
// AurasPainterDeps (which would need hud.ts to wire it): AURA_OVERFLOW_TEXT is the
// real-runtime implementation AurasPainter's constructor defaults to, so the ordinary
// caller (hud.ts) needs to pass nothing at all, while a test can still override it with a
// fake, matching the existing renderTooltip/attachTooltip injection pattern.

import { formatNumber, t, tPlural } from './i18n';

export interface AuraOverflowTextDeps {
  /** The "+N" badge label (host: hudChrome.unitFrame.buffOverflowLabel). */
  label(count: number): string;
  /** The badge's native `title` tooltip (host: tPlural over hudChrome.plurals.buffsHidden). */
  tooltip(count: number): string;
}

export const AURA_OVERFLOW_TEXT: AuraOverflowTextDeps = {
  label: (count) =>
    t('hudChrome.unitFrame.buffOverflowLabel', {
      n: formatNumber(count, { maximumFractionDigits: 0 }),
    }),
  tooltip: (count) => tPlural('hudChrome.plurals.buffsHidden', count),
};
