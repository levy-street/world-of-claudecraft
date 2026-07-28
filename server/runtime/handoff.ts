import type { RuntimeRoute } from './contract';
import type { RuntimeRouter } from './router';

export type HandoffState = 'preparing' | 'prepared' | 'committed' | 'aborted';

export interface RuntimeHandoff {
  characterId: string;
  source: RuntimeRoute;
  targetRuntimeKey: string;
  state: HandoffState;
}

export function beginHandoff(source: RuntimeRoute, targetRuntimeKey: string): RuntimeHandoff {
  if (source.runtimeKey === targetRuntimeKey) {
    throw new Error('handoff target must differ from source runtime');
  }
  return {
    characterId: source.characterId,
    source,
    targetRuntimeKey,
    state: 'preparing',
  };
}

export function markHandoffPrepared(handoff: RuntimeHandoff): void {
  if (handoff.state !== 'preparing') throw new Error('handoff is not preparing');
  handoff.state = 'prepared';
}

export function commitHandoff(router: RuntimeRouter, handoff: RuntimeHandoff): RuntimeRoute {
  if (handoff.state !== 'prepared') throw new Error('handoff target is not prepared');
  const route = router.commit(
    handoff.characterId,
    handoff.source.routeEpoch,
    handoff.targetRuntimeKey,
  );
  handoff.state = 'committed';
  return route;
}

export function abortHandoff(handoff: RuntimeHandoff): void {
  if (handoff.state === 'committed') throw new Error('committed handoff cannot be aborted');
  if (handoff.state === 'aborted') return;
  handoff.state = 'aborted';
}
