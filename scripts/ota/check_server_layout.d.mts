// Type declarations for the pure exports in check_server_layout.mjs, imported
// by tests/ota_server_layout.test.ts (the .mjs has no inline types, mirrors
// publish_bundle.d.mts).

export interface WorldApiContract {
  layoutVersion: number;
  authType: string;
  timerWire: number;
  incompatibleMessage: string;
}

export interface ProbeFrame {
  t: string;
  token: string;
  character: number;
  clientSeed: string;
  timerWire: number;
}

export type LayoutVerdict = 'compatible' | 'incompatible' | 'inconclusive';

export const LAYOUT_VERDICT: {
  compatible: 'compatible';
  incompatible: 'incompatible';
  inconclusive: 'inconclusive';
};

export const NOT_AUTHENTICATED_ERROR: string;

export function parseWorldApiContract(source: string): WorldApiContract;
export function buildProbeFrame(contract: WorldApiContract): ProbeFrame;
export function classifyHandshakeReply(
  raw: string,
  contract: WorldApiContract,
): { verdict: LayoutVerdict; detail: string };
