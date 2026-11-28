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
// capped too. Entries are also indexed by owning group, so a viewer's read on
// the server's self wire is one lookup (and nothing at all while no group has
// a mark). Cleanup: a disbanded party's entries go with it (the A1 disband path
// through ctx.dropPartyMarkers, beside the target markers); an emptied entry
// goes at once; an entry whose claim is no longer live is invisible at once and
// pruned on the next edit anywhere.
//
// A mark is ONE thing shown in two places: the map reads its page point
// (instance-local yards), the 3D world draws it on the floor at its world point
// (wx, y, wz). It can be placed from either: from the map (a page point, whose
// floor height the sim resolves) or by clicking the ground in the world
// (placeWorld: a world point plus the clicked height as a hint, which only
// picks the floor storey; the height is always the sim's own floor query).
//
// Cosmetic, session-only state: never read by tick(), obs or persistence, and
// it draws no rng. Every edit is validated here, so the online server (which
// runs this same Sim) is authoritative: membership, position, bounds, symbol,
// page, permission and a sim-clock rate limit. A refused edit is dropped
// silently (no player text): the client already hides the controls a player
// may not use.
//
// src/sim-pure: no DOM/Three, no Math.random/Date.now.

import {
  instanceClaimContains,
  instanceHalfWidthOf,
  instanceOriginOf,
  soloInstanceKeyFor,
} from '../instances/dungeons';
import { floorHeightAt } from '../physics';
import type { InstanceSlot, Party } from '../sim';
import type { SimContext } from '../sim_context';
import { groundHeight } from '../world';

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
/** One sender's share of the group window (a party member cannot starve the rest). */
export const SHARED_MAP_MARK_SENDER_EDITS_PER_WINDOW = 8;
/** The most live entries (instance claims with marks) the store holds. */
export const SHARED_MAP_MARK_MAX_ENTRIES = 512;
/** How far over the reference height (the clicked point, or the bare floor
 *  for a map placement) a standable top still counts as the mark's floor:
 *  the walking step reach, so a mark lands on a step or a dais, never on a
 *  storey overhead. */
export const SHARED_MAP_MARK_STEP_REACH = 0.9;

/** One shared mark: a symbol on a map page point (instance-local yards) and
 *  the same mark's world point on the floor (world yards, `y` the floor
 *  height the sim resolved). */
export interface SharedMapMark {
  symbol: number;
  page: number;
  x: number;
  z: number;
  wx: number;
  y: number;
  wz: number;
}

/** The floor a mark at world (x, z) stands on: the sim's own movement floor
 *  (terrain, instance floor, standable tops within a step) under `ref`, the
 *  clicked height when the mark was placed in the world, else the bare
 *  ground there. Never above ref + the step reach, never below the ground. */
export function sharedMapMarkFloorY(
  seed: number,
  x: number,
  z: number,
  ref: number | null,
): number {
  const base = ref !== null && Number.isFinite(ref) ? ref : groundHeight(x, z, seed);
  return floorHeightAt(seed, x, z, 0, base + SHARED_MAP_MARK_STEP_REACH);
}

interface Entry {
  claimId: number;
  inst: InstanceSlot;
  /** The group that owns these marks (InstanceSlot.partyKey at placement). */
  partyKey: string;
  /** The group of the last editor (instanceKeyFor at placement): a claim made
   *  solo and marked after grouping up drops its marks when that group goes. */
  groupKey: string;
  marks: SharedMapMark[];
  /** The marks as wire JSON, built once per change (serialize-once). */
  json: string | null;
}

/** A claim's rate window: the group's recent edit times and each sender's. */
interface EditWindow {
  inst: InstanceSlot;
  claimId: number;
  group: number[];
  bySender: Map<number, number[]>;
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

/** The one empty view (frozen): a viewer with no marks reads it every frame. */
const NO_MARKS: readonly SharedMapMark[] = Object.freeze([]);

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function recent(times: readonly number[], now: number): number[] {
  return times.filter((t) => now - t < SHARED_MAP_MARK_EDIT_WINDOW_S);
}

export class SharedMapMarks {
  /** Entries with at least one mark, by claim id. */
  private readonly entries = new Map<number, Entry>();
  /** The same entries by owning group key: a viewer's read is one lookup. */
  private readonly byOwner = new Map<string, Entry[]>();
  /** Rate windows by claim id (kept apart so an emptied entry can go at once). */
  private readonly windows = new Map<number, EditWindow>();

  constructor(private readonly ctx: SimContext) {}

  /** Entries held (tests and the retention story read it). */
  get size(): number {
    return this.entries.size;
  }

  /** Rate windows held (the retention story: pruned with their claims). */
  get windowCount(): number {
    return this.windows.size;
  }

  /** Place (or move) `symbol` at instance-local (x, z) on `page` (the map's
   *  placement: the floor height is the bare floor's there). */
  place(page: number, x: number, z: number, symbol: number, pid?: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    return this.put(page, symbol, pid, () => ({ x, z, ref: null }));
  }

  /** Place (or move) `symbol` at WORLD (x, z), clicked at height `y`, on
   *  `page` (the world placement). The point must lie in the claim the sender
   *  stands in; `y` only picks the floor storey (sharedMapMarkFloorY). */
  placeWorld(page: number, x: number, y: number, z: number, symbol: number, pid?: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    return this.put(page, symbol, pid, (inst) => {
      const o = instanceOriginOf(inst);
      return { x: x - o.x, z: z - o.z, ref: y };
    });
  }

  /** The shared validation and write of both placements. */
  private put(
    page: number,
    symbol: number,
    pid: number | undefined,
    local: (inst: InstanceSlot) => { x: number; z: number; ref: number | null },
  ): boolean {
    if (!Number.isInteger(symbol) || symbol < 0 || symbol >= SHARED_MAP_MARK_SYMBOLS) return false;
    if (!Number.isInteger(page) || page < 0 || page >= SHARED_MAP_MARK_PAGES) return false;
    const at = this.editableClaim(pid);
    if (!at) return false;
    const p = local(at.inst);
    if (Math.abs(p.x) >= instanceHalfWidthOf(at.inst.dungeonId)) return false;
    if (Math.abs(p.z) >= SHARED_MAP_MARK_REACH_Z) return false;
    this.prune();
    if (!this.spendEdit(at.inst, at.claimId, at.self)) return false;
    const entry = this.entryFor(at.inst, at.claimId);
    if (!entry) return false;
    entry.groupKey = this.ctx.instanceKeyFor(at.self);
    const o = instanceOriginOf(at.inst);
    const lx = round1(p.x);
    const lz = round1(p.z);
    const wx = o.x + lx;
    const wz = o.z + lz;
    const y = round2(sharedMapMarkFloorY(this.ctx.cfg.seed, wx, wz, p.ref));
    const mark: SharedMapMark = { symbol, page, x: lx, z: lz, wx, y, wz };
    // A fresh array per edit: a reader holding the last view never sees it change.
    const rest = entry.marks.filter((m) => m.symbol !== symbol);
    entry.marks =
      rest.length === entry.marks.length
        ? [...rest, mark]
        : entry.marks.map((m) => (m.symbol === symbol ? mark : m));
    entry.json = null;
    return true;
  }

  /** Clear one symbol, or every mark (`symbol` null). */
  clear(symbol: number | null, pid?: number): boolean {
    if (symbol !== null && (!Number.isInteger(symbol) || symbol < 0)) return false;
    if (symbol !== null && symbol >= SHARED_MAP_MARK_SYMBOLS) return false;
    const at = this.editableClaim(pid);
    if (!at) return false;
    this.prune();
    const entry = this.entries.get(at.claimId);
    if (!entry) return false;
    if (!this.spendEdit(at.inst, at.claimId, at.self)) return false;
    const before = entry.marks.length;
    entry.marks = symbol === null ? [] : entry.marks.filter((m) => m.symbol !== symbol);
    entry.json = null;
    // An emptied entry goes at once (its rate window stays until the claim dies).
    if (entry.marks.length === 0) this.drop(entry);
    return entry.marks.length !== before;
  }

  /** The marks `pid` sees: its group's, in the instance copy it stands in.
   *  Empty anywhere else. */
  viewFor(pid: number): readonly SharedMapMark[] {
    return this.visibleEntry(pid)?.marks ?? NO_MARKS;
  }

  /** The self-wire row for `pid`: the visible marks as
   *  [symbol, page, x, z, wx, y, wz] rows, or null. Serialized once per change
   *  and shared by the group. */
  wireFor(pid: number): string {
    if (this.entries.size === 0) return 'null';
    const entry = this.visibleEntry(pid);
    if (!entry) return 'null';
    entry.json ??= JSON.stringify(
      entry.marks.map((m) => [m.symbol, m.page, m.x, m.z, m.wx, m.y, m.wz]),
    );
    return entry.json;
  }

  /** A disbanded party's marks go with it. */
  dropParty(partyId: number): void {
    const key = `party:${partyId}`;
    const gone = [...this.entries.values()].filter((e) => e.partyKey === key || e.groupKey === key);
    for (const entry of gone) {
      this.drop(entry);
      this.windows.delete(entry.claimId);
    }
  }

  private live(inst: InstanceSlot, claimId: number, partyKey: string): boolean {
    return inst.exitId === claimId && inst.partyKey === partyKey;
  }

  private visibleEntry(pid: number): Entry | null {
    if (this.entries.size === 0) return null;
    const e = this.ctx.entities.get(pid);
    if (!e || !this.ctx.players.has(pid)) return null;
    for (const key of this.ownerKeys(pid)) {
      const owned = this.byOwner.get(key);
      if (!owned) continue;
      for (const entry of owned) {
        if (!this.live(entry.inst, entry.claimId, entry.partyKey)) continue;
        if (instanceClaimContains(entry.inst, e.pos)) return entry;
      }
    }
    return null;
  }

  /** The claim keys `pid`'s group owns: its own instance key and, in a party,
   *  each member's solo key (a player who entered solo and grouped up inside
   *  keeps the claim under that solo key; the group still marks it). */
  private ownerKeys(pid: number): string[] {
    const keys = [this.ctx.instanceKeyFor(pid)];
    const party = this.ctx.partyOf(pid);
    if (party) for (const m of party.members) keys.push(soloInstanceKeyFor(this.ctx, m));
    return keys;
  }

  /** The live claim `pid` stands in and may edit: its group's own claim, with
   *  edit rights (canEditSharedMapMarks). */
  private editableClaim(
    pid?: number,
  ): { inst: InstanceSlot; claimId: number; self: number } | null {
    const r = this.ctx.resolve(pid);
    if (!r) return null;
    const self = r.meta.entityId;
    if (!canEditSharedMapMarks(this.ctx.partyOf(self), self)) return null;
    const keys = this.ownerKeys(self);
    for (const inst of this.ctx.instances) {
      if (inst.partyKey === null || inst.exitId === null) continue;
      if (!keys.includes(inst.partyKey)) continue;
      if (instanceClaimContains(inst, r.e.pos)) return { inst, claimId: inst.exitId, self };
    }
    return null;
  }

  private entryFor(inst: InstanceSlot, claimId: number): Entry | null {
    const found = this.entries.get(claimId);
    if (found) return found;
    if (this.entries.size >= SHARED_MAP_MARK_MAX_ENTRIES) return null;
    const partyKey = inst.partyKey ?? '';
    const entry: Entry = { claimId, inst, partyKey, groupKey: partyKey, marks: [], json: null };
    this.entries.set(claimId, entry);
    const owned = this.byOwner.get(partyKey);
    if (owned) owned.push(entry);
    else this.byOwner.set(partyKey, [entry]);
    return entry;
  }

  private drop(entry: Entry): void {
    this.entries.delete(entry.claimId);
    const owned = this.byOwner.get(entry.partyKey);
    if (!owned) return;
    const rest = owned.filter((e) => e !== entry);
    if (rest.length > 0) this.byOwner.set(entry.partyKey, rest);
    else this.byOwner.delete(entry.partyKey);
  }

  /** Drop every entry and window whose claim was freed, reset or handed to
   *  another group (run on every edit; both maps are bounded by live claims). */
  private prune(): void {
    for (const entry of [...this.entries.values()])
      if (!this.live(entry.inst, entry.claimId, entry.partyKey)) this.drop(entry);
    for (const [id, w] of this.windows) if (w.inst.exitId !== w.claimId) this.windows.delete(id);
  }

  /** Spend one edit from the claim's group window and the sender's own share
   *  of it (so in a party one member cannot starve the others). */
  private spendEdit(inst: InstanceSlot, claimId: number, sender: number): boolean {
    const now = this.ctx.time;
    let w = this.windows.get(claimId);
    if (!w) {
      w = { inst, claimId, group: [], bySender: new Map() };
      this.windows.set(claimId, w);
    }
    w.group = recent(w.group, now);
    if (w.group.length >= SHARED_MAP_MARK_EDITS_PER_WINDOW) return false;
    const mine = recent(w.bySender.get(sender) ?? [], now);
    if (mine.length >= SHARED_MAP_MARK_SENDER_EDITS_PER_WINDOW) return false;
    for (const [id, times] of w.bySender)
      if (id !== sender && recent(times, now).length === 0) w.bySender.delete(id);
    mine.push(now);
    w.bySender.set(sender, mine);
    w.group.push(now);
    return true;
  }
}
