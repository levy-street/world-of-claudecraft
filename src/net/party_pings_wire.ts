// The `pings` self-wire row (the group's party pings, server
// src/sim/social/party_pings.ts wireFor) decoded for the ClientWorld mirror:
// null or [id, kind, from, fromName, target, x, y, z, targetKind,
// targetTemplate, targetName] rows (target 0 and targetKind '' for a ground
// ping). Every field is re-validated and a malformed row is DROPPED, so a
// version-skewed or hostile frame can never put a bad kind or a non-finite
// point in the world. DOM-free, ClientWorld-free.
//
// PartyPingReplayGuard: a fresh session's first self snapshot always carries
// the row (the server diffs against an empty per-session record), so the
// pings it holds were sent before this client (re)joined. They are flagged
// `known`: the world still draws them, but the feed never replays their sound
// and chat line after a reconnect or a reload.

import { isPingKind, PARTY_PING_GROUP_MAX, type PartyPing } from '../sim/social/party_pings';
import type { EntityKind } from '../sim/types';

const NONE: readonly PartyPing[] = Object.freeze([]);
const ENTITY_KINDS: readonly string[] = ['player', 'mob', 'npc', 'object'];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

export function decodePartyPings(raw: unknown): readonly PartyPing[] {
  if (!Array.isArray(raw)) return NONE;
  const out: PartyPing[] = [];
  const seen = new Set<number>();
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== 11 || out.length >= PARTY_PING_GROUP_MAX) continue;
    const [id, kind, from, fromName, target, x, y, z, tk, tt, tn] = row as unknown[];
    if (!posInt(id) || seen.has(id) || !isPingKind(kind) || !posInt(from)) continue;
    if (typeof fromName !== 'string' || typeof tt !== 'string' || typeof tn !== 'string') continue;
    if (!finite(x) || !finite(y) || !finite(z)) continue;
    const unit = target !== 0;
    if (unit && (!posInt(target) || typeof tk !== 'string' || !ENTITY_KINDS.includes(tk))) continue;
    seen.add(id);
    out.push({
      id,
      kind,
      from,
      fromName,
      target: unit ? (target as number) : null,
      targetKind: unit ? (tk as EntityKind) : null,
      targetTemplate: unit ? tt : '',
      targetName: unit ? tn : '',
      x,
      y,
      z,
    });
  }
  return out.length > 0 ? out : NONE;
}

/** Flags the pings already live when a session (re)connected (see the header). */
export class PartyPingReplayGuard {
  private baselinePending = true;
  private known = new Set<number>();

  /** A new socket session: its first `pings` row is the baseline. */
  newSession(): void {
    this.baselinePending = true;
  }

  /** The decoded row with every baseline ping flagged `known`. */
  mark(pings: readonly PartyPing[]): readonly PartyPing[] {
    if (this.baselinePending) {
      this.baselinePending = false;
      this.known = new Set(pings.map((p) => p.id));
    } else if (this.known.size > 0) {
      for (const id of this.known) if (!pings.some((p) => p.id === id)) this.known.delete(id);
    }
    if (this.known.size === 0) return pings;
    return pings.map((p) => (this.known.has(p.id) ? { ...p, known: true as const } : p));
  }
}
