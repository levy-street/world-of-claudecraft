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
  sigilAppears: 'hudChrome.nythraxisCallout.sigilAppears',
  sigilBound: 'hudChrome.nythraxisCallout.sigilBound',
  sigilUnbound: 'hudChrome.nythraxisCallout.sigilUnbound',
  gravefireTarget: 'hudChrome.nythraxisCallout.gravefireTarget',
  kingsWrath: 'hudChrome.nythraxisCallout.kingsWrath',
  boneStormBegins: 'hudChrome.nythraxisCallout.boneStormBegins',
  boneStormCharge: 'hudChrome.nythraxisCallout.boneStormCharge',
  boneStormEnds: 'hudChrome.nythraxisCallout.boneStormEnds',
  crownEndures60: 'hudChrome.nythraxisCallout.crownEndures60',
  crownEndures30: 'hudChrome.nythraxisCallout.crownEndures30',
  crownEndures10: 'hudChrome.nythraxisCallout.crownEndures10',
  crownEndures: 'hudChrome.nythraxisCallout.crownEndures',
} as const satisfies Record<NythraxisCallout, `hudChrome.nythraxisCallout.${string}`>;

export function nythraxisCalloutKey(
  call: NythraxisCallout,
): (typeof CALLOUT_KEYS)[NythraxisCallout] {
  return CALLOUT_KEYS[call];
}
