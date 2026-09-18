// The meters' party membership set: the viewer, every party or raid member,
// and every pet a member owns. The meters ask for it every HUD frame and on
// every combat event, and building it means a walk of the whole entity roster
// (for the pets) plus two Set allocations. The set only changes when the
// viewer changes, the member list changes, or an entity joins or leaves the
// roster (a pet summoned or dismissed), so this keeps the last answer and
// rebuilds it on exactly those three keys. A pet's `kind` and `ownerId` are
// fixed at its creation on both worlds (the online mirror creates an entity
// only from a record that carries its identity), which is what lets the
// roster version stand in for them. Callers read the set; they never write
// into it.
//
// Pure (UI_PURE_CORES): no DOM, no i18n, no IWorld import.

export interface PartyPidsWorld {
  player: { id: number };
  partyInfo: { members: readonly { pid: number }[] } | null;
  entities: ReadonlyMap<number, { id: number; kind: string; ownerId: number | null }>;
  entityRosterVersion: number;
}

/** The plain, allocating computation: what the cache answers, always. */
export function collectPartyPids(world: PartyPidsWorld): Set<number> {
  const pids = new Set<number>([world.player.id]);
  for (const m of world.partyInfo?.members ?? []) pids.add(m.pid);
  for (const e of world.entities.values()) {
    if (e.kind === 'mob' && e.ownerId !== null && pids.has(e.ownerId)) pids.add(e.id);
  }
  return pids;
}

export class PartyPidsCache {
  private playerId = Number.NaN;
  private rosterVersion = Number.NaN;
  private readonly members: number[] = [];
  private pids: ReadonlySet<number> = new Set();

  /** The current set; the same instance while nothing it depends on changed. */
  get(world: PartyPidsWorld): ReadonlySet<number> {
    if (
      world.player.id === this.playerId &&
      world.entityRosterVersion === this.rosterVersion &&
      this.membersUnchanged(world.partyInfo?.members ?? [])
    ) {
      return this.pids;
    }
    this.playerId = world.player.id;
    this.rosterVersion = world.entityRosterVersion;
    const members = world.partyInfo?.members ?? [];
    this.members.length = members.length;
    for (let i = 0; i < members.length; i++) this.members[i] = members[i].pid;
    this.pids = collectPartyPids(world);
    return this.pids;
  }

  private membersUnchanged(members: readonly { pid: number }[]): boolean {
    if (members.length !== this.members.length) return false;
    for (let i = 0; i < members.length; i++) if (members[i].pid !== this.members[i]) return false;
    return true;
  }
}
