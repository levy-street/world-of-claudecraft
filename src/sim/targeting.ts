// Player target selection + party-scoped raid markers (session T1), MOVED out of the
// 17.5k-line Sim class behind SimContext. This is a MOVE, not a rewrite: every method
// body below is the verbatim body from sim.ts, with the only change being that the
// shared-Sim references (resolve / stopFollow / entities / grid / the hostility +
// arena helpers / partyOf / error / primaryId) now route through `this.ctx`. Statement
// order, branches, grid-traversal order, and in-place mutation are preserved exactly;
// the slice draws no rng, so the parity draw-order log must stay byte-identical.
//
// Two disjoint concerns share this module (and this class) but no state: the stateless
// target selectors (tab / nearest / friendly cycle, which only read/write entity
// fields through the seam) and the party-scoped raid-marker STORE (`partyMarkers`),
// which moved off Sim with its methods — mirroring the PartyMachine pattern (A1).
// `markersFor`/`setMarker`/`clearMarker`/`markerFor` plus the nine selectors stay
// reachable on Sim through thin same-named delegates (IWorld + the many foreign
// main/hud/renderer/server/obs call sites); `clearEntityMarker` (death/despawn hooks)
// and `dropPartyMarkers` (the A1 disband path) reach the moved code through the seam.
//
// src/sim-pure: imports only sibling sim types + the pure tab_target helpers (no DOM/
// Three/render/ui/game/net, no Math.random/Date.now), so it runs unchanged in Node,
// the browser, and the headless RL env (enforced by tests/architecture.test.ts).

import { deadTargetSelectable } from './dead_target';
import type { SimContext } from './sim_context';
import { isVcupCrossTeam } from './social/vale_cup';
import { orderTabTargets, TAB_QUERY_RADIUS } from './tab_target';
import type { Entity } from './types';

export class Targeting {
  // raid/target markers: partyId -> (enemy entityId -> markerId 0..7). A cosmetic,
  // party-scoped overlay — never read by tick()/obs/persistence. Moved off Sim; the
  // slice's private state, like the PartyMachine's four maps.
  partyMarkers = new Map<number, Map<number, number>>();

  constructor(private readonly ctx: SimContext) {}

  // ---------------------------------------------------------------------------
  // Target selection (tab / nearest / friendly cycle)
  // ---------------------------------------------------------------------------

  targetEntity(id: number | null, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const p = r.e;
    // switching to a different target ends a follow (re-targeting is manual intent)
    if (p.followTargetId !== null && id !== p.followTargetId)
      this.ctx.stopFollow(p, 'You stop following.');
    if (id === null) {
      p.targetId = null;
      p.autoAttack = false;
      return;
    }
    const e = this.ctx.entities.get(id);
    if (!e || (e.dead && !deadTargetSelectable(e, p.id))) return;
    p.targetId = id;
    if (!this.ctx.isHostileTo(p, e) || e.dead) p.autoAttack = false;
  }

  tabTarget(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const p = r.e;
    const candidates = this.enemyCandidates(p);
    if (candidates.length === 0) return;
    // Cycle the enemies the player can see / is fighting first; off-screen ones
    // stay reachable but never steal the selection (see tab_target.ts).
    const { ids, primaryCount } = orderTabTargets(
      candidates.map((c) => ({
        id: c.e.id,
        dx: c.e.pos.x - p.pos.x,
        dz: c.e.pos.z - p.pos.z,
        d: c.d,
        engaged: c.e.aggroTargetId === p.id || c.e.targetId === p.id,
      })),
      p.facing,
    );
    const curIdx = ids.indexOf(p.targetId ?? -1);
    if (curIdx === -1) {
      // No (or no longer valid) target: grab the priority enemy, cluster first.
      p.targetId = ids[0];
    } else if (curIdx < primaryCount) {
      // Cycling the near fight cluster: wrap back to its first (priority) mob
      // instead of stepping out to a distant idle enemy still in range.
      p.targetId = ids[(curIdx + 1) % primaryCount];
    } else {
      // Sitting on a distant fallback target: walk the rest of the fallback,
      // then wrap back into the near cluster.
      const next = curIdx + 1;
      p.targetId = next < ids.length ? ids[next] : ids[0];
    }
  }

  targetNearestEnemy(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const p = r.e;
    let best: Entity | null = null;
    let bestD2 = TAB_QUERY_RADIUS * TAB_QUERY_RADIUS;
    this.ctx.grid.forEachInRadius(p.pos.x, p.pos.z, TAB_QUERY_RADIUS, (e, d2) => {
      if (!this.isEnemyTargetCandidate(p, e)) return;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    });
    if (best) p.targetId = (best as Entity).id;
  }

  private enemyCandidates(p: Entity): { e: Entity; d: number }[] {
    const out: { e: Entity; d: number }[] = [];
    if (p.dead) return out;
    this.ctx.grid.forEachInRadius(p.pos.x, p.pos.z, TAB_QUERY_RADIUS, (e, d2) => {
      if (!this.isEnemyTargetCandidate(p, e)) return;
      out.push({ e, d: Math.sqrt(d2) });
    });
    return out;
  }

  private isEnemyTargetCandidate(attacker: Entity, target: Entity): boolean {
    if (attacker.dead) return false;
    if (target.id === attacker.id || target.dead) return false;
    if (this.ctx.isHostileTo(attacker, target)) return true;
    if (target.kind === 'mob' && target.ownerId !== null) {
      const owner = this.ctx.entities.get(target.ownerId);
      return !!owner && owner.kind === 'player' && this.isEnemyTargetCandidate(attacker, owner);
    }
    if (target.kind !== 'player') return false;
    const attackerPlayer = this.ctx.pvpController(attacker);
    if (!attackerPlayer || attackerPlayer.dead) return false;
    const match = this.ctx.arenaMatches.get(attackerPlayer.id);
    if (
      match &&
      match.state === 'countdown' &&
      this.ctx.isArenaCrossTeam(match, attackerPlayer.id, target.id)
    ) {
      return true;
    }
    // The Vale Cup: opposing fighters are keyboard-targetable from the whistle
    // (countdown) through play, so the Shoulder has a target to land on.
    // isHostileTo only opens during active/golden play, mirroring the arena's
    // countdown-targeting asymmetry.
    const cupMatch = this.ctx.vcup.match;
    return (
      !!cupMatch &&
      cupMatch.phase !== 'over' &&
      isVcupCrossTeam(cupMatch, attackerPlayer.id, target.id)
    );
  }

  // Nearby allies a beneficial spell can land on: other players (and friendly
  // pets) within range, never yourself, never dead/hostile. Mirrors the enemy
  // targeting helpers so heals/buffs are reachable by keyboard, not just by
  // clicking party frames or world models (#133).
  private friendlyCandidates(p: Entity): { e: Entity; d: number }[] {
    const out: { e: Entity; d: number }[] = [];
    this.ctx.grid.forEachInRadius(p.pos.x, p.pos.z, 40, (e, d2) => {
      if (e.id === p.id || e.dead || !this.ctx.isFriendlyTo(p, e)) return;
      out.push({ e, d: Math.sqrt(d2) });
    });
    return out;
  }

  targetNearestFriendly(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const p = r.e;
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const c of this.friendlyCandidates(p)) {
      if (c.d < bestD) {
        bestD = c.d;
        best = c.e;
      }
    }
    if (best) p.targetId = best.id;
  }

  friendlyTabTarget(pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const p = r.e;
    const candidates = this.friendlyCandidates(p);
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.d - b.d);
    const curIdx = candidates.findIndex((c) => c.e.id === p.targetId);
    const next = candidates[(curIdx + 1) % candidates.length];
    p.targetId = next.e.id;
  }

  // ---------------------------------------------------------------------------
  // Raid markers (party-scoped target markers)
  // ---------------------------------------------------------------------------

  // Every mark visible to the actor's party, as { entityId: markerId }. Empty
  // when the actor is not in a party. Pure read — cleanup happens on the
  // death/despawn/disband hooks, never here.
  markersFor(pid: number): Record<number, number> {
    const party = this.ctx.partyOf(pid);
    if (!party) return {};
    const marks = this.partyMarkers.get(party.id);
    if (!marks) return {};
    const out: Record<number, number> = {};
    for (const [eid, mid] of marks) out[eid] = mid;
    return out;
  }

  setMarker(entityId: number, markerId: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const party = this.ctx.partyOf(r.meta.entityId);
    if (!party) {
      this.ctx.error(r.meta.entityId, 'You must be in a party to use raid markers.');
      return;
    }
    if (!Number.isInteger(markerId) || markerId < 0 || markerId > 7) return;
    // markable: a live, wild, hostile mob (not players, NPCs, corpses, or pets)
    const target = this.ctx.entities.get(entityId);
    if (target?.kind !== 'mob' || target.dead || !target.hostile || target.ownerId !== null) return;
    let marks = this.partyMarkers.get(party.id);
    if (!marks) {
      marks = new Map();
      this.partyMarkers.set(party.id, marks);
    }
    // re-applying the same symbol to the same mob toggles it off
    if (marks.get(entityId) === markerId) {
      marks.delete(entityId);
      return;
    }
    // a symbol is unique within the party: take it off whatever held it
    for (const [eid, mid] of marks) {
      if (mid === markerId) marks.delete(eid);
    }
    marks.set(entityId, markerId);
  }

  clearMarker(entityId: number, pid?: number): void {
    const r = this.ctx.resolve(pid);
    if (!r) return;
    const party = this.ctx.partyOf(r.meta.entityId);
    if (!party) return;
    this.partyMarkers.get(party.id)?.delete(entityId);
  }

  // The local player's view of one entity's mark (for the renderer). Direct
  // lookup, no per-call allocation.
  markerFor(entityId: number): number | null {
    const party = this.ctx.partyOf(this.ctx.primaryId);
    if (!party) return null;
    return this.partyMarkers.get(party.id)?.get(entityId) ?? null;
  }

  // Strip an entity's mark from every party — used when it dies or despawns.
  clearEntityMarker(entityId: number): void {
    for (const marks of this.partyMarkers.values()) marks.delete(entityId);
  }

  // Drop a disbanded party's whole raid-marker set (the A1 removeFromParty
  // disband path calls this through ctx.dropPartyMarkers).
  dropPartyMarkers(partyId: number): void {
    this.partyMarkers.delete(partyId);
  }
}
