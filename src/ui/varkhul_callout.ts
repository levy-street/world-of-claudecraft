import type { SimEvent } from '../sim/types';

type VarkhulCallout = Extract<SimEvent, { type: 'varkhulCallout' }>['call'];

const CALLOUT_KEYS = {
  leftPillarCharging: 'hudChrome.varkhulCallout.leftPillarCharging',
  rightPillarCharging: 'hudChrome.varkhulCallout.rightPillarCharging',
  bothPillarsCharging: 'hudChrome.varkhulCallout.bothPillarsCharging',
  leftPillar: 'hudChrome.varkhulCallout.leftPillar',
  rightPillar: 'hudChrome.varkhulCallout.rightPillar',
  bothPillars: 'hudChrome.varkhulCallout.bothPillars',
  portalsOpening: 'hudChrome.varkhulCallout.portalsOpening',
  artificerApproaches: 'hudChrome.varkhulCallout.artificerApproaches',
  heat75: 'hudChrome.varkhulCallout.heat75',
  heat90: 'hudChrome.varkhulCallout.heat90',
  addsDefeated: 'hudChrome.varkhulCallout.addsDefeated',
  worldfireBegins: 'hudChrome.varkhulCallout.worldfireBegins',
  worldfireClosing: 'hudChrome.varkhulCallout.worldfireClosing',
  worldfireConsumed: 'hudChrome.varkhulCallout.worldfireConsumed',
} as const;

export function varkhulCalloutKey(call: VarkhulCallout): (typeof CALLOUT_KEYS)[VarkhulCallout] {
  return CALLOUT_KEYS[call];
}
