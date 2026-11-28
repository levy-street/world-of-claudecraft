// Party pings: the quick "look here / attack this" callouts a group trades in
// a fight (the ping wheel). A player pings a world point or a unit, and every
// member of their party or raid (solo: only themself) sees it for a few
// seconds: an icon in the world, a minimap mark, a sound and a chat line, all
// drawn by the client from this store's view.
//
// Server-authoritative: the client sends a `ping` command and this module owns
// every rule. The sender must resolve to a live session; a point must be
// finite and lie within PARTY_PING_RANGE of the sender (its floor height is
// the sim's own floor query, the clicked height only picks the storey); a
// unit must exist, be alive, be in range, not be hidden by stealth from a
// sender outside its group, and not be anything the sender's own snapshot
// omits (a hidden GM, another group's vault portal). A refused ping is dropped silently: the client's
// own gates already keep a normal player from sending one.
//
// Anti-spam on the SIM clock (never the wall clock): a sender may spend
// PARTY_PING_BURST pings per PARTY_PING_WINDOW_S sliding window, then waits for
// the oldest to age out. A group holds at most PARTY_PING_GROUP_MAX live pings
// and a sender at most PARTY_PING_SENDER_MAX of them (the oldest goes first).
//
// A ping lives PARTY_PING_LIFETIME_S; one attached to a unit also ends when
// that unit dies or despawns. Expiry is lazy (deterministic, sim time): every
// read and every send prunes, so no tick phase is involved. A disbanded
// party's pings go with it (the A1 disband path, ctx.dropPartyMarkers).
//
// Cosmetic, session-only state: never read by tick(), obs or persistence, and
// it draws no rng. The group's view is serialized once per change and shared
// by every member's self wire (`pings`).
//
// src/sim-pure: no DOM/Three, no Math.random/Date.now.

import { gmHiddenFrom } from '../gm_presence';
import type { SimContext } from '../sim_context';
import { type EntityKind, PLAYER_INTEREST_RADIUS } from '../types';
import { vaultPortalVisibleToPlayer } from '../vault_visibility';
import { duelFor } from './duel';
import { sharedMapMarkFloorY } from './shared_map_marks';

/** The ping kinds, by wire index. Look Here is the plain ground ping a tap
 *  sends; the other four are the wheel's wedges. */
export const PING_LOOK = 0;
export const PING_ATTACK = 1;
export const PING_WARNING = 2;
export const PING_ON_MY_WAY = 3;
export const PING_ASSIST = 4;
export const PING_KIND_COUNT = 5;

/** How long a ping stays up (sim seconds). */
export const PARTY_PING_LIFETIME_S = 4.5;
/** How far from the sender a pinged point may be (yards). A pinged player or
 *  mob must also lie inside PLAYER_INTEREST_RADIUS (the snapshot interest), so
 *  the sender was sent what they pinged; NPCs and objects ride a wider one. */
export const PARTY_PING_RANGE = 110;
/** How far above or below the sender a pinged point or unit may be (yards). */
export const PARTY_PING_VERTICAL_REACH = 45;
/** A sender's pings per sliding window (sim seconds). */
export const PARTY_PING_BURST = 4;
export const PARTY_PING_WINDOW_S = 5;
/** Live pings a group holds, and one sender's share of them. */
export const PARTY_PING_GROUP_MAX = 12;
export const PARTY_PING_SENDER_MAX = 3;
/** The most groups the store holds at once (each with a live ping). */
export const PARTY_PING_MAX_GROUPS = 2048;

/** One live ping as every group member sees it. A unit ping carries the unit
 *  (id, kind, template and raw name, so a viewer outside its interest can
 *  still name it) and the point where it stood when pinged. */
export interface PartyPing {
  id: number;
  kind: number;
  from: number;
  fromName: string;
  target: number | null;
  targetKind: EntityKind | null;
  targetTemplate: string;
  targetName: string;
  x: number;
  y: number;
  z: number;
  /** Set by the online client's mirror only (src/net/party_pings_wire.ts):
   *  the ping was already live when this client (re)connected, so it draws
   *  but is not announced again (no sound, no chat line). Never set here. */
  known?: true;
}

interface LivePing extends PartyPing {
  until: number;
}

interface Group {
  pings: LivePing[];
  /** The view as wire JSON, built once per change (serialize-once). */
  json: string | null;
}

const NO_PINGS: readonly PartyPing[] = Object.freeze([]);

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** True for a wire ping kind. */
export function isPingKind(kind: unknown): kind is number {
  return typeof kind === 'number' && Number.isInteger(kind) && kind >= 0 && kind < PING_KIND_COUNT;
}

/** The store key of `pid`'s group: its party, or itself when solo. */
export function pingGroupKey(partyId: number | null, pid: number): string {
  return partyId === null ? `solo:${pid}` : `party:${partyId}`;
}

export class PartyPings {
  private readonly groups = new Map<string, Group>();
  /** Each sender's recent ping times (sim seconds), for the sliding window. */
  private readonly sent = new Map<number, number[]>();
  private nextId = 1;

  constructor(private readonly ctx: SimContext) {}

  /** Groups held (tests and the retention story read it). */
  get size(): number {
    return this.groups.size;
  }

  /** Senders with a live rate window (pruned on every send). */
  get senderCount(): number {
    return this.sent.size;
  }

  /** Ping `kind` at a unit (`target`) or, with target null, at the world
   *  point (x, y, z). Returns whether the ping was accepted. */
  send(
    kind: number,
    target: number | null,
    x: number,
    y: number,
    z: number,
    pid?: number,
  ): boolean {
    if (!isPingKind(kind)) return false;
    const r = this.ctx.resolve(pid);
    if (!r) return false;
    const self = r.meta.entityId;
    const at = r.e.pos;
    const party = this.ctx.partyOf(self);
    let point: { x: number; y: number; z: number };
    let unit: { id: number; kind: EntityKind; template: string; name: string } | null = null;
    if (target !== null) {
      if (!Number.isInteger(target)) return false;
      const t = this.ctx.entities.get(target);
      if (!t || t.dead) return false;
      const groupMate = t.id === self || (party?.members.includes(t.id) ?? false);
      if (t.stealthed && !groupMate) return false;
      // A duel hides a stealthed party mate from their opponent too.
      if (t.stealthed && t.id !== self) {
        const duel = duelFor(this.ctx, self);
        if (duel && (duel.a === t.id || duel.b === t.id)) return false;
      }
      // Players and mobs reach a snapshot only inside PLAYER_INTEREST_RADIUS
      // (NPCs and objects farther): never ping a unit the sender was not sent.
      if (
        (t.kind === 'player' || t.kind === 'mob') &&
        Math.hypot(t.pos.x - at.x, t.pos.y - at.y, t.pos.z - at.z) > PLAYER_INTEREST_RADIUS
      )
        return false;
      // Never what the sender's own snapshot omits: a hidden GM (forged id) or
      // another group's vault portal would leak its name and spot to the group.
      if (gmHiddenFrom(this.ctx.entities, r.e, t)) return false;
      if (!vaultPortalVisibleToPlayer(this.ctx, t, self)) return false;
      point = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
      const name = t.kind === 'player' ? (this.ctx.players.get(t.id)?.name ?? t.name) : t.name;
      unit = { id: t.id, kind: t.kind, template: t.templateId ?? '', name };
    } else {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
      point = { x, y, z };
    }
    if (Math.hypot(point.x - at.x, point.z - at.z) > PARTY_PING_RANGE) return false;
    if (Math.abs(point.y - at.y) > PARTY_PING_VERTICAL_REACH) return false;
    const now = this.ctx.time;
    // A sender over their budget is refused before the store-wide sweep, so
    // spamming past the limit costs the server nothing.
    if (!this.canSpend(self, now)) return false;
    this.pruneAll(now);
    const key = pingGroupKey(party?.id ?? null, self);
    let group = this.groups.get(key);
    if (!group) {
      if (this.groups.size >= PARTY_PING_MAX_GROUPS) return false;
      group = { pings: [], json: null };
    }
    if (!this.spend(self, now)) return false;
    this.groups.set(key, group);
    const y0 = unit
      ? round2(point.y)
      : round2(sharedMapMarkFloorY(this.ctx.cfg.seed, point.x, point.z, point.y));
    const ping: LivePing = {
      id: this.nextId++,
      kind,
      from: self,
      fromName: r.meta.name,
      target: unit?.id ?? null,
      targetKind: unit?.kind ?? null,
      targetTemplate: unit?.template ?? '',
      targetName: unit?.name ?? '',
      x: round2(point.x),
      y: y0,
      z: round2(point.z),
      until: now + PARTY_PING_LIFETIME_S,
    };
    // A fresh array per change: a reader holding the last view never sees it move.
    let pings = group.pings.filter((p) => p.until > now);
    const mine = pings.filter((p) => p.from === self);
    if (mine.length >= PARTY_PING_SENDER_MAX) pings = pings.filter((p) => p !== mine[0]);
    if (pings.length >= PARTY_PING_GROUP_MAX) pings = pings.slice(1);
    group.pings = [...pings, ping];
    group.json = null;
    return true;
  }

  /** The pings `pid` sees: its group's live ones (solo: its own). */
  viewFor(pid: number): readonly PartyPing[] {
    if (this.groups.size === 0) return NO_PINGS;
    const group = this.groupOf(pid);
    return group ? group.pings : NO_PINGS;
  }

  /** The self-wire row for `pid`: the group's live pings as
   *  [id, kind, from, fromName, target, x, y, z, targetKind, targetTemplate,
   *  targetName] rows (target 0 and targetKind '' for a point), or null.
   *  Serialized once per change and shared by the group. */
  wireFor(pid: number): string {
    if (this.groups.size === 0) return 'null';
    const group = this.groupOf(pid);
    if (!group) return 'null';
    group.json ??= JSON.stringify(
      group.pings.map((p) => [
        p.id,
        p.kind,
        p.from,
        p.fromName,
        p.target ?? 0,
        p.x,
        p.y,
        p.z,
        p.targetKind ?? '',
        p.targetTemplate,
        p.targetName,
      ]),
    );
    return group.json;
  }

  /** A disbanded party's pings go with it. */
  dropParty(partyId: number): void {
    this.groups.delete(pingGroupKey(partyId, 0));
  }

  /** `pid`'s group, pruned to its live pings (null when none are left). */
  private groupOf(pid: number): Group | null {
    if (!this.ctx.players.has(pid)) return null;
    const key = pingGroupKey(this.ctx.partyOf(pid)?.id ?? null, pid);
    const group = this.groups.get(key);
    if (!group) return null;
    if (!this.prune(group, this.ctx.time)) {
      this.groups.delete(key);
      return null;
    }
    return group;
  }

  /** Drop a group's expired pings and the ones whose unit died or despawned.
   *  Returns whether any ping is left. */
  private prune(group: Group, now: number): boolean {
    const live = (p: LivePing): boolean => {
      if (p.until <= now) return false;
      if (p.target === null) return true;
      const t = this.ctx.entities.get(p.target);
      return !!t && !t.dead;
    };
    if (!group.pings.every(live)) {
      group.pings = group.pings.filter(live);
      group.json = null;
    }
    return group.pings.length > 0;
  }

  /** Every send sweeps the whole store: emptied groups and idle rate windows
   *  go, so both maps stay bounded by what is live. */
  private pruneAll(now: number): void {
    for (const [key, group] of this.groups) if (!this.prune(group, now)) this.groups.delete(key);
    for (const [id, times] of this.sent)
      if (times.every((t) => now - t >= PARTY_PING_WINDOW_S)) this.sent.delete(id);
  }

  /** Whether `sender` has a ping left in their sliding window (no change). */
  private canSpend(sender: number, now: number): boolean {
    const times = this.sent.get(sender);
    if (!times) return true;
    let live = 0;
    for (const t of times) if (now - t < PARTY_PING_WINDOW_S) live++;
    return live < PARTY_PING_BURST;
  }

  /** Spend one ping from `sender`'s sliding window. */
  private spend(sender: number, now: number): boolean {
    const times = (this.sent.get(sender) ?? []).filter((t) => now - t < PARTY_PING_WINDOW_S);
    if (times.length >= PARTY_PING_BURST) {
      this.sent.set(sender, times);
      return false;
    }
    times.push(now);
    this.sent.set(sender, times);
    return true;
  }
}
