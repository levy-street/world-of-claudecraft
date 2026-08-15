// Type declarations for the pure exports in check_server_layout.mjs, imported by
// tests/ota_server_layout.test.ts (the .mjs has no inline types, mirrors
// publish_bundle.d.mts).

import type { WorldAuthMessage } from '../lib/world_auth.d.mts';

export type LayoutVerdict = 'compatible' | 'incompatible' | 'inconclusive';

export const LAYOUT_VERDICT: {
  compatible: 'compatible';
  incompatible: 'incompatible';
  inconclusive: 'inconclusive';
};

export const NOT_AUTHENTICATED_ERROR: string;

export function buildProbeFrame(): WorldAuthMessage;
export function classifyHandshakeReply(raw: string): { verdict: LayoutVerdict; detail: string };
