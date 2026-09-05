import type { Sim } from '../src/sim/sim';
import { parsePerfectItemRef, resolvePerfectItemName } from './perfect_item_ref';

interface PerfectItemCommandHost {
  sim: Pick<Sim, 'perfectingInfo' | 'perfectItemAs'>;
  pid: number;
  offensiveName(name: string): boolean;
  accepted(): void;
  refusedName(): void;
}

/** Preserve the existing shape-first name screen and mark only accepted frames. */
export function dispatchPerfectItemCommand(
  msg: Record<string, unknown>,
  host: PerfectItemCommandHost,
): void {
  const ref = parsePerfectItemRef(msg);
  if (!ref) return;
  const promoting = () => host.sim.perfectingInfo(ref, host.pid)?.perfected === true;
  const named = resolvePerfectItemName(msg, host.offensiveName, promoting);
  if (named.refused) host.refusedName();
  else {
    host.accepted();
    host.sim.perfectItemAs(host.pid, ref, named.name);
  }
}
