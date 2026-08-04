import type { SimEvent } from '../src/sim/types';

type CombatEventParty = {
  members: readonly number[];
};

function isViewerCombatParticipant(
  sourceId: number,
  targetId: number,
  viewerPid: number,
  viewerParty: CombatEventParty | null,
  sourceOwnerId: number | null = null,
  targetOwnerId: number | null = null,
): boolean {
  if (
    sourceId === viewerPid ||
    targetId === viewerPid ||
    sourceOwnerId === viewerPid ||
    targetOwnerId === viewerPid
  )
    return true;
  return (
    viewerParty?.members.includes(sourceId) === true ||
    viewerParty?.members.includes(targetId) === true ||
    (sourceOwnerId !== null && viewerParty?.members.includes(sourceOwnerId) === true) ||
    (targetOwnerId !== null && viewerParty?.members.includes(targetOwnerId) === true)
  );
}

export function shouldDeliverCombatEventToViewer(
  ev: SimEvent,
  viewerPid: number,
  viewerParty: CombatEventParty | null,
): boolean {
  if (ev.type === 'damage')
    return isViewerCombatParticipant(
      ev.sourceId,
      ev.targetId,
      viewerPid,
      viewerParty,
      ev.sourceOwnerId ?? null,
      ev.targetOwnerId ?? null,
    );
  if (ev.type === 'heal2')
    return isViewerCombatParticipant(
      ev.sourceId,
      ev.targetId,
      viewerPid,
      viewerParty,
      ev.sourceOwnerId ?? null,
      ev.targetOwnerId ?? null,
    );
  return true;
}
