import type { ActionBarLayoutRestore } from '../world_api/action_bar';

/** Offline layouts live in localStorage; consume the no-server-copy marker once per world. */
export function offlineActionBarRestore(): () => ActionBarLayoutRestore | undefined {
  let served = false;
  return () => {
    if (served) return undefined;
    served = true;
    return { source: 'noop' };
  };
}
