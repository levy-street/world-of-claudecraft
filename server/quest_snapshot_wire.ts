import type { PlayerMeta, Sim } from '../src/sim/sim';

type EmitSelfKey = (key: string, value: unknown) => void;

/** Emit the heavy owner-only quest snapshot family through the host's delta gate. */
export function emitQuestSelfKeys(emit: EmitSelfKey, sim: Sim, meta: PlayerMeta): void {
  emit('qlog', [...meta.questLog.values()]);
  emit('qdone', [...meta.questsDone]);
  emit('wqday', meta.worldQuestCycle);
  emit('wqexp', sim.worldQuestExpiresAtMs);
  emit('wqlog', [...meta.worldQuestLog.values()]);
}
