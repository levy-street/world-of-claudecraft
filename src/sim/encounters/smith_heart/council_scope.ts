// The Hammer Council's per-tick scope: the claim, the shared state, the three
// bodies, the players on the Quarry floor, the difficulty's rules and the bar
// plumbing every member module uses. A leaf the council's member modules
// (council_wrath.ts, council_stone.ts, council_song.ts) and the coordinator
// (council.ts) share, so none of them reaches into another. Zero rng.

import { HAMMER_PIT } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { pickMarkTargets, startBar } from '../sunken_bastion/claim';
import {
  COUNCIL_DIFFICULTY,
  type CouncilDifficultyRules,
  type CouncilJob,
  type CouncilRole,
  JOB_HEIRS,
  JOB_OWNER,
} from './council_ids';
import type { CouncilFightState } from './council_state';

/** How far from the Quarry's middle the council's mechanics reach (the pit
 *  floor and its first step: a player on the Gallery's stair is out of it). */
export const COUNCIL_ARENA_R = 52;

export interface CouncilScope {
  ctx: SimContext;
  inst: InstanceSlot;
  st: CouncilFightState;
  bodies: Readonly<Record<CouncilRole, Entity | null>>;
  /** Living players on the Quarry floor, entity-id order. */
  players: readonly Entity[];
  rules: CouncilDifficultyRules;
}

/** Living, present players of a claim standing in the Quarry, entity-id order. */
export function quarryPlayers(ctx: SimContext, inst: InstanceSlot): Entity[] {
  const o = ctx.instanceOriginOf(inst);
  const out: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead || e.ghost) continue;
    const d = Math.hypot(e.pos.x - o.x - HAMMER_PIT.x, e.pos.z - o.z - HAMMER_PIT.z);
    if (d <= COUNCIL_ARENA_R) out.push(e);
  }
  return out.sort((a, b) => a.id - b.id);
}

export function rulesOf(st: CouncilFightState): CouncilDifficultyRules {
  return COUNCIL_DIFFICULTY[st.difficulty];
}

/** A body that stands and fights (alive). */
export function living(e: Entity | null): e is Entity {
  return e !== null && !e.dead && e.hp > 0;
}

/** Who holds a job now: its own member while it lives, else the first living
 *  heir, else nobody. */
export function jobHolder(
  s: Pick<CouncilScope, 'bodies'>,
  job: CouncilJob,
): { role: CouncilRole; body: Entity; heir: boolean } | null {
  const own = JOB_OWNER[job];
  const b = s.bodies[own];
  if (living(b)) return { role: own, body: b, heir: false };
  for (const r of JOB_HEIRS[job]) {
    const h = s.bodies[r];
    if (living(h)) return { role: r, body: h, heir: true };
  }
  return null;
}

/** Is this member free to begin a bar now? */
export function memberFree(s: CouncilScope, role: CouncilRole): boolean {
  const b = s.bodies[role];
  if (!living(b)) return false;
  if (s.st.bars[role] || b.castingAbility !== null) return false;
  if (s.st.gaps[role] > 0) return false;
  return !s.ctx.isStunned(b);
}

/** Begin a council bar on a member: a real cast bar every client mirrors,
 *  its feet planted where it began. */
export function beginBar(
  s: CouncilScope,
  role: CouncilRole,
  castId: string,
  seconds: number,
  targetId: number | null,
  heir: boolean,
): void {
  const b = s.bodies[role];
  if (!b) return;
  s.st.casts++;
  s.st.bars[role] = { castId, at: { ...b.pos }, heir, targetId };
  startBar(b, castId, seconds, targetId);
  if (targetId !== null) {
    const t = s.ctx.entities.get(targetId);
    if (t) b.facing = Math.atan2(t.pos.x - b.pos.x, t.pos.z - b.pos.z);
  }
}

/** The players a mark takes: hashed among the living non-tanks of the floor
 *  (the tank only when nobody else is free). Zero rng. */
export function pickMarks(
  s: CouncilScope,
  hasher: Entity,
  count: number,
  busy: ReadonlySet<number> = new Set(),
): Entity[] {
  // Never the one any council member is fighting while anyone else stands.
  const tanks = new Set<number>();
  for (const r of ['guardian', 'slabwright', 'singer'] as const) {
    const b = s.bodies[r];
    if (living(b) && b.aggroTargetId !== null) tanks.add(b.aggroTargetId);
  }
  const salt = s.st.casts * 11 + 3;
  const out = pickMarkTargets(
    hasher,
    s.players.filter((p) => !tanks.has(p.id)),
    count,
    salt,
    busy,
  );
  if (out.length >= count) return out;
  // Short of free players: the tanks make up the rest.
  const taken = new Set([...busy, ...out.map((p) => p.id)]);
  return out.concat(pickMarkTargets(hasher, s.players, count - out.length, salt + 1, taken));
}

/** Every mechanic's damage factor: the difficulty's and the body's own. */
export function damageMult(s: CouncilScope, body: Entity): number {
  return s.rules.damageMult * (body.mechanicDamageMult ?? 1);
}

/** A mechanic's damage roll (the only rng the council draws). */
export function roll(s: CouncilScope, body: Entity, min: number, max: number): number {
  return Math.max(1, Math.round(s.ctx.rng.range(min, max) * damageMult(s, body)));
}

/** A raid warning from a council member to every player in the claim (the
 *  big orange line, re-localized client-side by `textKey`). */
export function raidWarn(
  s: CouncilScope,
  from: Entity,
  key: string,
  text: string,
  values?: Record<string, string>,
): void {
  for (const meta of s.ctx.players.values()) {
    const p = s.ctx.entities.get(meta.entityId);
    if (!p) continue;
    const o = s.ctx.instanceOriginOf(s.inst);
    if (Math.hypot(p.pos.x - o.x - HAMMER_PIT.x, p.pos.z - o.z - HAMMER_PIT.z) > 120) continue;
    s.ctx.emit({
      type: 'chat',
      fromPid: from.id,
      from: from.name,
      entityId: from.id,
      text,
      textKey: `hudChrome.council.warn.${key}`,
      ...(values ? { textValues: values } : {}),
      channel: 'raidWarning',
      pid: meta.entityId,
    });
  }
}

/** Hold a member where its bar began (the mob AI may have walked it). */
export function holdPlantedAt(
  ctx: SimContext,
  mob: Entity,
  at: { x: number; y: number; z: number },
): void {
  if (mob.pos.x === at.x && mob.pos.z === at.z) return;
  mob.pos.x = at.x;
  mob.pos.y = at.y;
  mob.pos.z = at.z;
  ctx.rebucket(mob);
}

/** Players' names joined for a warning line ("A, B and C" stays a list of
 *  names: "A, B, C"). */
export function namesOf(players: readonly Entity[]): string {
  return players.map((p) => p.name).join(', ');
}
