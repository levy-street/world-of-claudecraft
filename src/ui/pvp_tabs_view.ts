// Pure view model for the merged PvP window's tab strip: Thornhollow Fields first (the
// primary tab), then the two ranked arena brackets. It derives busy-state from
// the two IWorld snapshots itself (so the painter never re-implements the
// resolution), decides which tab is pinned (a live queue or match commits its
// own tab), and locks the rest while one mode is busy, so the UI can never
// queue two PvP modes at once. DOM-free and i18n-free (root CLAUDE.md
// pure-core contract); the painter in arena_window.ts renders and wires it.

import type { ArenaFormat, ArenaInfo, BgInfo } from '../world_api';

/** The merged window's tabs, in display order: Thornhollow Fields is primary. */
export type PvpTabId = 'ravenrift' | '1v1' | '2v2';
export const PVP_TABS: readonly PvpTabId[] = ['ravenrift', '1v1', '2v2'];

export interface PvpTabState {
  id: PvpTabId;
  active: boolean;
  locked: boolean;
}

export interface PvpTabsInput {
  /** The painter's current selection. */
  selected: PvpTabId;
  /** The battleground snapshot (null offline / not yet synced). */
  bg: Pick<BgInfo, 'queued' | 'match'> | null;
  /** The arena snapshot (null offline / not yet synced). */
  arena: Pick<ArenaInfo, 'queued' | 'format' | 'match'> | null;
}

export interface PvpTabsModel {
  tabs: PvpTabState[];
  /** The resolved selection (a busy mode pins its own tab). */
  active: PvpTabId;
  /** True when the painter should adopt `active` as its stored selection. */
  commit: boolean;
}

/**
 * Resolve the strip. A busy mode pins its tab; the battleground wins a
 * (sim-impossible) tie. A busy arena bracket the strip no longer offers (a
 * dev-started Fiesta or Protect Yumi bout) pins nothing: the selection stays
 * where it is, and every other tab still locks while the bout runs. The
 * queued/match resolution here mirrors buildArenaView's, fed by the same
 * IWorld snapshots, so the offline Sim and the online ClientWorld mirror
 * produce identical strips.
 */
export function buildPvpTabs(input: PvpTabsInput): PvpTabsModel {
  const bgBusy = Boolean(input.bg && (input.bg.queued || input.bg.match !== null));
  const arenaBusyBracket: ArenaFormat | null = input.arena
    ? (input.arena.match?.format ?? (input.arena.queued ? input.arena.format : null))
    : null;
  const offeredArena: PvpTabId | null =
    arenaBusyBracket === '1v1' || arenaBusyBracket === '2v2' ? arenaBusyBracket : null;
  const pinned: PvpTabId | null = bgBusy ? 'ravenrift' : offeredArena;
  const active = pinned ?? input.selected;
  const busy = bgBusy || arenaBusyBracket !== null;
  return {
    tabs: PVP_TABS.map((id) => ({ id, active: id === active, locked: busy && id !== active })),
    active,
    commit: pinned !== null,
  };
}
