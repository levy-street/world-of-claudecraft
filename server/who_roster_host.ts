import type { Sim } from '../src/sim/sim';
import { type RealmReadoutMemo, realmReadoutObject } from './realm_readout_memo';
import {
  buildWhoRosterEntries,
  visibleWhoRows,
  type WhoRosterEntry,
  type WhoRosterRow,
  type WhoVisibilitySession,
} from './who_roster';

// Adapt the live world to the pure /who roster seam. GameServer retains the
// per-tick memo and per-viewer filtering; entries retain live session handles.
export function buildLiveWhoRosterEntries<
  S extends WhoVisibilitySession & { pid: number; name: string },
>(
  sim: Pick<Sim, 'entities' | 'meta'>,
  sessions: Iterable<S>,
  presenceOf: (session: S) => Pick<WhoRosterRow, 'zone' | 'status'>,
): WhoRosterEntry<S>[] {
  return buildWhoRosterEntries(sessions, (session) => {
    const entity = sim.entities.get(session.pid);
    const meta = sim.meta(session.pid);
    // A hidden GM is excluded from both /who projections, including its own.
    if (!entity || !meta || entity.gmHidden) return null;
    const { zone, status } = presenceOf(session);
    return {
      name: session.name,
      cls: meta.cls,
      level: entity.level,
      guild: entity.guild,
      zone,
      status,
    };
  });
}

// Build and name-sort once per tick, then apply the viewer's CURRENT block
// rules through the live session handles. Only zone/status leave the realm:
// presence also contains x/z, reserved for the friend/guild socialpos frame.
export function readLiveWhoRows<S extends WhoVisibilitySession & { pid: number; name: string }>(
  sim: Pick<Sim, 'entities' | 'meta' | 'tickCount'>,
  sessions: Iterable<S>,
  memo: RealmReadoutMemo<WhoRosterEntry<S>[]>,
  viewer: S,
  presenceOf: (session: S) => Pick<WhoRosterRow, 'zone' | 'status'>,
): WhoRosterRow[] {
  const entries = realmReadoutObject(memo, sim.tickCount, () =>
    buildLiveWhoRosterEntries(sim, sessions, presenceOf),
  );
  return visibleWhoRows(entries, viewer);
}
