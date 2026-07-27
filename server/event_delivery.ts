import type { SimEvent } from '../src/sim/types';

type CombatEventParty = {
  members: readonly number[];
};

export function shouldDeliverCombatEventToViewer(
  ev: SimEvent,
  viewerPid: number,
  viewerParty: CombatEventParty | null,
): boolean {
  if (ev.type !== 'damage') return true;
  if (ev.sourceId === viewerPid || ev.targetId === viewerPid) return true;
  return (
    viewerParty?.members.includes(ev.sourceId) === true ||
    viewerParty?.members.includes(ev.targetId) === true
  );
}
