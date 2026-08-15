import { cleanIp } from './ip_block';

export const UNKNOWN_IP_ASSOCIATION = 'unknown';

// Association reads may need to investigate the exact marker persisted when no
// client address was available. Mutation paths deliberately keep using cleanIp
// directly, so this marker can never become a block-list entry.
export function cleanIpAssociationLookup(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return cleanIp(text) || (text === UNKNOWN_IP_ASSOCIATION ? text : '');
}
