import {
  capturePerfectItemRef,
  type PerfectItemRef,
  type PerfectingCopyReads,
} from '../sim/professions/perfecting_copy';

/** Preserve a prompt's capture; direct IWorld callers capture the current mirror. */
export function perfectingCommand(reads: PerfectingCopyReads, ref: PerfectItemRef, name?: string) {
  const copy = capturePerfectItemRef(reads, ref).copy;
  return {
    ...('slot' in ref ? { slot: ref.slot } : { bag: ref.bag, item: ref.itemId }),
    copy,
    name,
  };
}
