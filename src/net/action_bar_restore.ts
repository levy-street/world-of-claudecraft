import {
  type ActionBarLayoutRestore,
  sanitizeActionBarLayoutProfiles,
} from '../world_api/action_bar';

/** Resolve only the first self payload, before the HUD consumes its one-shot restore.
 * A fresh login carries hbl as a profile document or explicit null (seed from
 * local). A resumed session may omit it, leaving the local mirror authoritative.
 */
export function resolveInitialActionBarLayout(hbl: unknown): ActionBarLayoutRestore {
  if (hbl === undefined) return { source: 'noop' };
  const profiles = hbl === null ? null : sanitizeActionBarLayoutProfiles(hbl);
  return profiles ? { source: 'server', profiles } : { source: 'seed' };
}
