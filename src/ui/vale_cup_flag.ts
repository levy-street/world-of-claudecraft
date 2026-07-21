// Procedural Vale Cup nation flags for the HUD (window picker, indicator,
// match strip). Pure string builders: no DOM, no i18n. Each flag is a small
// inline SVG whose two colors come straight from the VC_NATIONS data record
// (src/sim/content/vale_cup.ts), delivered as CSS custom properties on the
// wrapper so the stylesheet stays token-driven. This is the ONE documented
// data-driven color exception for the vcup painters: the hex strings are
// DERIVED from sim content (never literals in this module or the painters),
// mirroring how the render-side flag textures consume the same record.
//
// The away palette (both teams picked the same banner) swaps field and accent,
// exactly like the pitch-side dressing does.

import { VC_NATIONS, type VcNationDef } from '../sim/content/vale_cup';
import type { VcNationId } from '../sim/types';

/** Localized-name keys per nation (the painters resolve them through t()). */
export const VCUP_NATION_NAME_KEYS = {
  vale: 'hudChrome.vcup.nation.vale',
  mirefen: 'hudChrome.vcup.nation.mirefen',
  thornpeak: 'hudChrome.vcup.nation.thornpeak',
  coliseum: 'hudChrome.vcup.nation.coliseum',
  choir: 'hudChrome.vcup.nation.choir',
  ogre: 'hudChrome.vcup.nation.ogre',
  moon: 'hudChrome.vcup.nation.moon',
  copperdig: 'hudChrome.vcup.nation.copperdig',
} as const;

/** 0xrrggbb -> #rrggbb (derived from data, not a literal). */
export function vcupHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

// Emblem glyphs, hand-authored 24x24 silhouettes drawn in the accent color.
// Kept deliberately chunky so they read at 14px in the picker grid and on the
// match strip.
const EMBLEM_PATHS: Record<VcNationDef['emblem'], string> = {
  // a wheat sheaf: center stalk with three grain pairs
  wheat:
    'M11.3 21V10.5h1.4V21h-1.4zM12 3.2c1.5 1 2.4 2.5 2.4 4.1-1.6-.2-2.9-1.5-3.1-3 .2-.5.4-.8.7-1.1zm0 0c-1.5 1-2.4 2.5-2.4 4.1 1.6-.2 2.9-1.5 3.1-3-.2-.5-.4-.8-.7-1.1zM8.2 8.2c1.8.2 3.2 1.4 3.6 3.1-1.8-.1-3.3-1.4-3.6-3.1zm7.6 0c-1.8.2-3.2 1.4-3.6 3.1 1.8-.1 3.3-1.4 3.6-3.1zM7.6 12.4c1.8.2 3.3 1.5 3.7 3.2-1.9-.1-3.4-1.4-3.7-3.2zm8.8 0c-1.8.2-3.3 1.5-3.7 3.2 1.9-.1 3.4-1.4 3.7-3.2z',
  // a wading heron: long neck, folded wing
  heron:
    'M9.5 21c.3-3.4 1.2-5.8 2.7-7.4 1.1-1.2 1.7-2.2 1.7-3.4 0-1.4-.9-2.4-2.2-2.4-.9 0-1.6.4-2.2 1.1l-1-1c.8-1 2-1.6 3.3-1.6 2.2 0 3.7 1.6 3.7 3.8 0 1.7-.8 3-2.1 4.5-1.2 1.3-1.9 3.3-2.2 6.4H9.5zm4.8-14.8 3.2-1 -2.6 2 -0.6-1z',
  // a mountain peak with a snow cap
  peak: 'M12 4l8 16H4l8-16zm0 3.4L9.6 12.2l1.2-.7 1.2 1 1.2-1 1.2.7L12 7.4z',
  // two crossed swords
  swords:
    'M5 4l6 6-1.4 1.4L4 6V4h1zm14 0h1v2l-5.6 5.4L13 10l6-6zM8.5 13.5l2 2L7 19l-2 1-1-2 3.5-3.5-1-1 1-1 1 1zm7 0l1-1 1 1-1 1L20 18l-1 2-2-1-3.5-3.5 2-2z',
  // a chapel bell with clapper
  bell: 'M12 3.5c.7 0 1.2.5 1.2 1.2v.5c2.6.6 4.3 2.7 4.3 5.6 0 2.9.6 4.4 1.7 5.5v1.2H4.8v-1.2c1.1-1.1 1.7-2.6 1.7-5.5 0-2.9 1.7-5 4.3-5.6v-.5c0-.7.5-1.2 1.2-1.2zm0 16.5c-1 0-1.8-.6-2.1-1.5h4.2c-.3.9-1.1 1.5-2.1 1.5z',
  // a raised fist
  fist: 'M8.2 4.8h2.2v4h.8v-4.5h2.2v4.5h.8V5.2h2.2v4.1h.8V6.5h1.6v7.1c0 3.4-2.3 5.9-5.7 5.9-3.5 0-5.9-2.5-5.9-6v-3.2h1.6v2.4h.8V4.8h.6z',
  // a waxing crescent
  crescent:
    'M14.6 3.6c-3.6 1-6.2 4.3-6.2 8.4 0 4.1 2.6 7.4 6.2 8.4-1 .4-2 .6-3.1.6-5 0-9-4-9-9s4-9 9-9c1.1 0 2.1.2 3.1.6z',
  // a miner's pick
  pick: 'M11 12.6 4.6 19l1.4 1.4 6.4-6.4-1.4-1.4zm1-4.2 3.6 3.6 1.4-1.4c1.4.9 2.5 2 3.2 3.4.5-3-.5-6-2.7-8.2S12.4 2.7 9.4 3.2c1.4.7 2.5 1.8 3.4 3.2L11.4 7.8l.6.6z',
};

export interface VcupFlagOpts {
  /** Swap field and accent (the away side under a same-banner clash). */
  away?: boolean;
  /** Extra class on the wrapper (e.g. 'lg' for the match strip). */
  cls?: string;
}

/** One nation flag as an inline-SVG chip (decorative: text labels ride beside it). */
export function vcupFlagHtml(id: VcNationId, opts: VcupFlagOpts = {}): string {
  const nation = VC_NATIONS.find((n) => n.id === id);
  if (!nation) return '';
  const field = vcupHex(opts.away ? nation.secondary : nation.primary);
  const accent = vcupHex(opts.away ? nation.primary : nation.secondary);
  const cls = opts.cls ? ` ${opts.cls}` : '';
  return (
    `<span class="vcup-flag${cls}" style="--vcup-field:${field};--vcup-accent:${accent}" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">` +
    `<path d="${EMBLEM_PATHS[nation.emblem]}"></path>` +
    `</svg></span>`
  );
}
