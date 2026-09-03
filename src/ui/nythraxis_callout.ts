// Nythraxis raid callouts: the text-free `nythraxisCallout` SimEvent carries only
// an enum; this map owns which catalogued banner line each call renders. The
// Varkhul callout's sibling (varkhul_callout.ts); raid_callout.ts selects between
// the two so hud.ts holds one arm for both bosses.

import type { SimEvent } from '../sim/types';

export type NythraxisCallout = Extract<SimEvent, { type: 'nythraxisCallout' }>['call'];

const CALLOUT_KEYS = {
  impaled: 'hudChrome.nythraxisCallout.impaled',
  youAreImpaled: 'hudChrome.nythraxisCallout.youAreImpaled',
  spikeBroken: 'hudChrome.nythraxisCallout.spikeBroken',
  dreadCurseSwap: 'hudChrome.nythraxisCallout.dreadCurseSwap',
} as const satisfies Record<NythraxisCallout, `hudChrome.nythraxisCallout.${string}`>;

export function nythraxisCalloutKey(
  call: NythraxisCallout,
): (typeof CALLOUT_KEYS)[NythraxisCallout] {
  return CALLOUT_KEYS[call];
}
