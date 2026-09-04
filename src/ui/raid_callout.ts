// One banner-key selector for every structured raid callout event, so the HUD's
// event switch keeps a single arm for the whole family instead of one per boss.
// Each boss owns its key map (varkhul_callout.ts, nythraxis_callout.ts); this
// module only routes on the event type.

import type { SimEvent } from '../sim/types';
import { nythraxisCalloutKey } from './nythraxis_callout';
import { varkhulCalloutKey } from './varkhul_callout';

export type RaidCalloutEvent = Extract<SimEvent, { type: 'varkhulCallout' | 'nythraxisCallout' }>;

export function raidCalloutKey(
  event: RaidCalloutEvent,
): ReturnType<typeof varkhulCalloutKey> | ReturnType<typeof nythraxisCalloutKey> {
  return event.type === 'varkhulCallout'
    ? varkhulCalloutKey(event.call)
    : nythraxisCalloutKey(event.call);
}
