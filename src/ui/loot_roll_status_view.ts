// Pure, DOM-free view core for the group loot-roll vote strip (the XLoot-style
// monitor): given the authoritative group statuses from IWorld.lootRollGroupStatus
// and the set of locally shown need/greed prompts, it decides which rows the HUD
// renders (a prompt row grows a vote strip; a status with no local prompt renders
// as a watch-only row so the frame stays up after the player answers) and yields
// a cheap fingerprint so the thin hud consumer re-renders only when membership,
// prompt-ness, or a vote actually changes. Follows the pure-core + thin-consumer
// pattern (see unit_portrait.ts) next to its sibling loot_roll_reconcile.ts.
import type { LootRollChoice, LootRollGroupStatus } from '../sim/types';

export interface LootRollStripEntry {
  pid: number;
  name: string;
  choice: LootRollChoice | null;
  self: boolean;
}

export interface LootRollStatusRow {
  rollId: number;
  itemId: string;
  itemName: string;
  quality: LootRollGroupStatus['quality'];
  expiresAt: number;
  // true while the local player's need/greed/pass prompt for this roll is still
  // on screen (the strip rides the prompt row); false renders the watch-only row.
  hasPrompt: boolean;
  // How many candidates have answered vs the total. Drives the "N/M rolled"
  // glance line so a full raid (RAID_MAX = 10) is readable without scanning
  // every chip for who is still deciding.
  answered: number;
  total: number;
  entries: LootRollStripEntry[];
}

export function computeLootRollStatusRows(
  statuses: readonly LootRollGroupStatus[],
  shownPromptIds: readonly number[],
  selfPid: number,
  includeWatchRows = true,
): LootRollStatusRow[] {
  const shown = new Set(shownPromptIds);
  const visibleStatuses = includeWatchRows
    ? statuses
    : statuses.filter((status) => shown.has(status.rollId));
  return visibleStatuses.map((status) => ({
    rollId: status.rollId,
    itemId: status.itemId,
    itemName: status.itemName,
    quality: status.quality,
    expiresAt: status.expiresAt,
    hasPrompt: shown.has(status.rollId),
    answered: status.entries.filter((entry) => entry.choice !== null).length,
    total: status.entries.length,
    entries: status.entries.map((entry) => ({
      pid: entry.pid,
      name: entry.name,
      choice: entry.choice,
      self: entry.pid === selfPid,
    })),
  }));
}

// Change key for the render-on-change gate: covers roll membership and order,
// prompt vs watch mode, and every candidate's vote. Names/item fields are keyed
// by rollId (immutable per roll), so they need no bytes here.
export function lootRollStatusFingerprint(rows: readonly LootRollStatusRow[]): string {
  let fp = '';
  for (const row of rows) {
    fp += `${row.rollId}${row.hasPrompt ? 'p' : 'w'}`;
    for (const entry of row.entries) fp += `,${entry.pid}=${entry.choice ?? '-'}`;
    fp += ';';
  }
  return fp;
}
