// Shared map marks: the raid world markers of a raid map. A group's leader
// (or, outside a raid, any member, and a solo player for themself) places one
// of the eight classic raid-marker symbols (star to skull, the same family as
// the target markers in src/sim/targeting.ts) on a point of the instance's map,
// and every group member standing in that instance copy sees it.
//
// The store is keyed by the live instance CLAIM (InstanceSlot.exitId, minted
// fresh on every claim, so a reset or a recycled slot can never show a past
// run's marks), and each entry remembers the group that placed it. A symbol is
// unique per claim, which caps an entry at eight marks; the store as a whole is
// capped too. Cleanup: a disbanded party's entries go with it (the A1 disband
// path through ctx.dropPartyMarkers, beside the target markers); an entry whose
// claim is no longer live is invisible at once and pruned on the next edit.
//
// Cosmetic, session-only state: never read by tick(), obs or persistence, and
// it draws no rng. Every edit is validated here, so the online server (which
// runs this same Sim) is authoritative: membership, position, bounds, symbol,
// page, permission and a sim-clock rate limit. A refused edit is dropped
// silently (no player text): the client already hides the controls a player
// may not use.
//
// src/sim-pure: no DOM/Three, no Math.random/Date.now.

import { instanceClaimContains, instanceHalfWidthOf } from '../instances/dungeons';
import type { InstanceSlot, Party } from '../sim';
import type { SimContext } from '../sim_context';

/** The eight raid-marker symbols (star, circle, diamond, triangle, moon,
 *  square, cross, skull), the target markers' indices. */
export const SHARED_MAP_MARK_SYMBOLS = 8;
/** The most map pages a raid map can have (the Smith's Heart has two). */
export const SHARED_MAP_MARK_PAGES = 4;
/** Instance-local yards a mark may sit from the instance origin along z (the
 *  footprint's depth; its width is the dungeon's own half width). */
export const SHARED_MAP_MARK_REACH_Z = 250;
/** A group may make this many edits per window (sim seconds). */
export const SHARED_MAP_MARK_EDITS_PER_WINDOW = 12;
export const SHARED_MAP_MARK_EDIT_WINDOW_S = 4;
/** The most live entries (instance claims with marks) the store holds. */
export const SHARED_MAP_MARK_MAX_ENTRIES = 512;

/** One shared mark: a symbol on a map page point, in instance-local yards. */
export interface SharedMapMark {
  symbol: number;
  page: number;
  x: number;
  z: number;
}

interface Entry {
  claimId: number;
  inst: InstanceSlot;
  /** The group that owns these marks (InstanceSlot.partyKey at placement). */
  partyKey: string;
  marks: SharedMapMark[];
  /** Sim times of the recent edits (the rate window). */
  edits: number[];
  /** The marks as wire JSON, built once per change (serialize-once). */
  json: string | null;
}

/** Who may edit a group's shared marks: everyone when solo or in a party, the
 *  leader only in a raid. (The game has no raid-assistant rank; one would
 *  join here and nowhere else.) */
export function canEditSharedMapMarks(
  party: Pick<Party, 'leader' | 'raid'> | null,
  pid: number,
): boolean {
  return !party || !party.raid || party.leader === pid;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export class SharedMapMarks {
  private readonly entries = new Map<number, Entry>();

  constructor(private readonly ctx: SimContext) {}

  /** Entries held (tests and the retention story read it). */
  get size(): number {
    return this.entries.size;
  }

  /** Place (or move) `symbol` at instance-local (x, z) on `page`. */
  place(page: number, x: number, z: number, symbol: number, pid?: number): boolean {
    if (!Number.isInteger(symbol) || symbol < 0 || symbol >= SHARED_MAP_MARK_SYMBOLS) return false;
    if (!Number.isInteger(page) || page < 0 || page >= SHARED_MAP_MARK_PAGES) return false;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const at = this.editableClaim(pid);
    if (!at) return false;
    if (Math.abs(x) >= instanceHalfWidthOf(at.inst.dungeonId)) return false;
    if (Math.abs(z) >= SHARED_MAP_MARK_REACH_Z) return false;
    const entry = this.entryFor(at.inst, at.claimId);
    if (!entry || !this.spendEdit(entry)) return false;
    const mark = { symbol, page, x: round1(x), z: round1(z) };
    const i = entry.marks.findIndex((m) => m.symbol === symbol);
    if (i >= 0) entry.marks[i] = mark;
    else entry.marks.push(mark);
    entry.json = null;
    return true;
  }

  /** Clear one symbol, or every mark (`symbol` null). */
  clear(symbol: number | null, pid?: number): boolean {
    if (symbol !== null && (!Number.isInteger(symbol) || symbol < 0)) return false;
    const at = this.editableClaim(pid);
    if (!at) return false;
    const entry = this.entries.get(at.claimId);
    if (!entry || entry.partyKey !== at.inst.partyKey) return false;
    if (!this.spendEdit(entry)) return false;
    const before = entry.marks.length;
    // An emptied entry stays (it keeps the rate window) until its claim dies.
    entry.marks = symbol === null ? [] : entry.marks.filter((m) => m.symbol !== symbol);
    entry.json = null;
    return entry.marks.length !== before;
  }

  /** The marks `pid` sees: its group's, in the instance copy it stands in.
   *  Empty anywhere else. */
  viewFor(pid: number): readonly SharedMapMark[] {
    return this.visibleEntry(pid)?.marks ?? [];
  }

  /** The self-wire row for `pid`: the visible marks as [symbol, page, x, z]
   *  rows, or null. Serialized once per change and shared by the group. */
  wireFor(pid: number): string {
    if (this.entries.size === 0) return 'null';
    const entry = this.visibleEntry(pid);
    if (!entry) return 'null';
    entry.json ??= JSON.stringify(entry.marks.map((m) => [m.symbol, m.page, m.x, m.z]));
    return entry.json;
  }

  /** A disbanded party's marks go with it. */
  dropParty(partyId: number): void {
    const key = `party:${partyId}`;
    for (const [id, entry] of this.entries) if (entry.partyKey === key) this.entries.delete(id);
  }

  private live(entry: Entry): boolean {
    return entry.inst.exitId === entry.claimId && entry.inst.partyKey === entry.partyKey;
  }

  private visibleEntry(pid: number): Entry | null {
    if (this.entries.size === 0) return null;
    const e = this.ctx.entities.get(pid);
    if (!e || !this.ctx.players.has(pid)) return null;
    const key = this.ctx.instanceKeyFor(pid);
    for (const entry of this.entries.values()) {
      if (entry.partyKey !== key || !this.live(entry)) continue;
      if (instanceClaimContains(entry.inst, e.pos)) return entry;
    }
    return null;
  }

  /** The live claim `pid` stands in and may edit: its group's own claim, with
   *  edit rights (canEditSharedMapMarks). */
  private editableClaim(pid?: number): { inst: InstanceSlot; claimId: number } | null {
    const r = this.ctx.resolve(pid);
    if (!r) return null;
    const self = r.meta.entityId;
    if (!canEditSharedMapMarks(this.ctx.partyOf(self), self)) return null;
    const key = this.ctx.instanceKeyFor(self);
    for (const inst of this.ctx.instances) {
      if (inst.partyKey !== key || inst.exitId === null) continue;
      if (instanceClaimContains(inst, r.e.pos)) return { inst, claimId: inst.exitId };
    }
    return null;
  }

  private entryFor(inst: InstanceSlot, claimId: number): Entry | null {
    const found = this.entries.get(claimId);
    if (found && found.partyKey === inst.partyKey) return found;
    this.prune();
    if (this.entries.size >= SHARED_MAP_MARK_MAX_ENTRIES) return null;
    const entry: Entry = {
      claimId,
      inst,
      partyKey: inst.partyKey ?? '',
      marks: [],
      edits: [],
      json: null,
    };
    this.entries.set(claimId, entry);
    return entry;
  }

  /** Drop every entry whose claim was freed, reset or handed to another group. */
  private prune(): void {
    for (const [id, entry] of this.entries) if (!this.live(entry)) this.entries.delete(id);
  }

  private spendEdit(entry: Entry): boolean {
    const now = this.ctx.time;
    entry.edits = entry.edits.filter((t) => now - t < SHARED_MAP_MARK_EDIT_WINDOW_S);
    if (entry.edits.length >= SHARED_MAP_MARK_EDITS_PER_WINDOW) return false;
    entry.edits.push(now);
    return true;
  }
}
