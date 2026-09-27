// The live wiring behind the player mouseover tooltip: the catalog lookups the
// pure view (player_tooltip_view.ts) takes as injected resolvers, bound once,
// so Hud.showPlayerHoverTooltip is a key check plus one call. No DOM here; the
// card is painted by Hud onto the shared #tooltip box.

import { talentsFor } from '../sim/content/talents';
import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';
import { deedTitleText } from './deed_i18n';
import { classDisplayName } from './entity_i18n';
import { formatNumber, type TranslationKey, t } from './i18n';
import { classColorCss } from './inspect_view';
import {
  type PlayerTooltipI18n,
  type PlayerTooltipResolvers,
  type PlayerTooltipSource,
  playerTooltipHtml,
  playerTooltipModel,
} from './player_tooltip_view';
import { roleLabel, tTalent } from './talent_i18n';

const I18N: PlayerTooltipI18n = {
  t: (key, params) => t(key as TranslationKey, params),
  fmt: (value, opts) => formatNumber(value, opts),
};

const isClass = (cls: string): cls is PlayerClass =>
  Object.hasOwn(CLASSES as Record<string, unknown>, cls);

const RESOLVERS: PlayerTooltipResolvers = {
  // An unknown template (a stale or foreign class id) prints the raw id rather
  // than a blank line, the behavior the hover card always had.
  classLabel: (cls) => (isClass(cls) ? classDisplayName(cls) : cls),
  classColor: classColorCss,
  titleText: deedTitleText,
  // Keyed by class first: spec ids collide across classes (paladin and priest
  // both have "holy"), so a bare spec-id lookup would name the wrong spec.
  spec: (cls, specId) => {
    const def = (isClass(cls) ? talentsFor(cls) : null)?.specs.find((s) => s.id === specId);
    return def
      ? {
          name: tTalent({ kind: 'talentSpec', spec: def, field: 'name' }),
          role: roleLabel(def.role),
        }
      : null;
  },
};

/** The painted card's HTML for another player hovered in the world. */
export function playerHoverTooltipHtml(e: PlayerTooltipSource): string {
  return playerTooltipHtml(playerTooltipModel(e, RESOLVERS), I18N);
}
