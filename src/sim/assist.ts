// Pure resolution for the "/assist <name>" chat command (group-play / multiboxing
// target-matching, classic MMO style): switch the caster's target to whatever the
// named player is currently fighting. When several mobs are stacked, clicking the
// right nameplate is fiddly; /assist lets everyone focus the same target by naming a
// party member instead. The Sim is a thin consumer (see Sim.chat): it builds the
// candidate roster from this.players + each player entity's targetId, calls this, and
// applies a 'target' result through targetEntity() (which does the dead/lootable
// validation). Kept host-agnostic and DOM-free so a Vitest drives every branch.

export interface AssistCandidate {
  /** The player's entity id. */
  entityId: number;
  /** The player's display name (used for exact/case-insensitive matching). */
  name: string;
  /** The entity this player is currently targeting, or null. */
  targetId: number | null;
}

export type AssistResolution =
  | { kind: 'target'; targetId: number; leaderName: string }
  | { kind: 'error'; message: string };

// Resolve a player by typed name: an exact-case match wins outright; otherwise a unique
// case-insensitive match is used; ties or misses become errors. Mirrors /follow so the
// two commands behave identically (and reuse the same already-localized error strings).
function findLeader(
  candidates: AssistCandidate[],
  typedName: string,
): AssistCandidate | { error: string } {
  const wanted = typedName.toLowerCase();
  const ci: AssistCandidate[] = [];
  for (const c of candidates) {
    if (c.name === typedName) return c;
    if (c.name.toLowerCase() === wanted) ci.push(c);
  }
  if (ci.length === 1) return ci[0];
  if (ci.length > 1) return { error: `Several players match '${typedName}'. Use exact capitalization.` };
  return { error: `There is no player named '${typedName}' online.` };
}

export function resolveAssist(
  candidates: Iterable<AssistCandidate>,
  casterId: number,
  rawName: string,
): AssistResolution {
  const list = [...candidates];
  const typedName = rawName.trim();

  let leader: AssistCandidate;
  if (typedName) {
    const found = findLeader(list, typedName);
    if ('error' in found) return { kind: 'error', message: found.error };
    leader = found;
  } else {
    // No name: assist whoever the caster currently has targeted, but only if that
    // target is itself a player in the roster (assisting a mob is meaningless).
    const caster = list.find((c) => c.entityId === casterId);
    const current = caster && caster.targetId !== null ? list.find((c) => c.entityId === caster.targetId) : undefined;
    if (!current) return { kind: 'error', message: 'Assist whom? Target a player or use /assist <name>.' };
    leader = current;
  }

  if (leader.entityId === casterId) return { kind: 'error', message: "You can't assist yourself." };
  if (leader.targetId === null) return { kind: 'error', message: `${leader.name} has no target.` };
  return { kind: 'target', targetId: leader.targetId, leaderName: leader.name };
}
