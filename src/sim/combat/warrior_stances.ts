// Warrior combat stances: a small, host-agnostic system layered on the existing
// aura + exclusive-group machinery. Every warrior always lives in exactly one
// stance for their current spec; the stance is auto-applied (and reconciled on a
// spec change) by ensureWarriorStance, and the player swaps it by casting a
// stance ability (the exclusiveGroup 'warrior_stance' cancels the sibling).
//
// The pure decision helpers (which stances a spec has, which is the default, and
// the reconcile diff) carry NO ctx/DOM and are unit-tested directly. The thin
// ensureWarriorStance consumer applies that decision through SimContext.
import { ABILITIES } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Aura, AuraKind, Entity } from '../types';

// The three stance ability ids (also their aura kinds and buff ids). Battle and
// Berserker are the offensive defaults; Guarded (defensive) is the Arms/Prot
// retreat stance. Fury lives only in Berserker (a pure bonus, no downside).
export const BATTLE_STANCE = 'battle_stance';
export const BERSERKER_STANCE = 'berserker_stance';
export const DEFENSIVE_STANCE = 'defensive_stance';

export const WARRIOR_STANCE_IDS: readonly string[] = [
  BATTLE_STANCE,
  DEFENSIVE_STANCE,
  BERSERKER_STANCE,
];

// The aura kinds that ARE a stance, so a caller can pick the stance auras off an
// entity without hardcoding the list at each site.
export const WARRIOR_STANCE_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'battle_stance',
  'defensive_stance',
  'berserker_stance',
]);

export function isWarriorStanceKind(kind: AuraKind): boolean {
  return WARRIOR_STANCE_KINDS.has(kind);
}

// The stance aura kinds a warrior of the given committed spec may wear. Mirrors
// the specs/excludeSpecs gating on the stance ability defs in classes.ts (a unit
// test pins the two in sync): Fury -> Berserker only; Arms/Prot -> Battle +
// Guarded; no spec -> Battle only.
export function availableWarriorStanceKinds(spec: string | null): AuraKind[] {
  if (spec === 'fury') return ['berserker_stance'];
  if (spec === 'arms' || spec === 'prot') return ['battle_stance', 'defensive_stance'];
  return ['battle_stance'];
}

// The stance a warrior of this spec defaults to (Fury -> Berserker, everyone
// else -> Battle). Always a learn-level-1 stance, so it is always applicable.
export function defaultWarriorStanceId(spec: string | null): string {
  return spec === 'fury' ? BERSERKER_STANCE : BATTLE_STANCE;
}

// Build the aura for a stance ability id from its selfBuff effect (the single
// source of the aura's kind/value/duration), or null if the id is not a stance
// selfBuff. Shared by the spawn-time seed (createPlayer) and the tick reconcile.
export function buildStanceAura(stanceId: string, ownerId: number): Aura | null {
  const def = ABILITIES[stanceId];
  const eff = def?.effects.find((e) => e.type === 'selfBuff');
  if (!def || !eff || eff.type !== 'selfBuff') return null;
  return {
    id: stanceId,
    name: def.name,
    kind: eff.kind,
    remaining: eff.duration,
    duration: eff.duration,
    value: eff.value,
    sourceId: ownerId,
    school: def.school,
  };
}

export interface StanceReconcile {
  // Stance aura kinds to strip (invalid for the current spec); empty when a
  // valid stance is already worn.
  removeKinds: AuraKind[];
  // The stance ability id to apply, or null when a valid stance is already worn.
  applyId: string | null;
}

// Pure reconcile: given the current spec and the stance kinds currently worn,
// decide whether the warrior already holds a valid stance (no change), or must
// drop the invalid ones and gain their spec's default stance.
export function warriorStanceReconcile(
  spec: string | null,
  currentStanceKinds: readonly AuraKind[],
): StanceReconcile {
  const available = availableWarriorStanceKinds(spec);
  if (currentStanceKinds.some((k) => available.includes(k))) {
    return { removeKinds: [], applyId: null };
  }
  return { removeKinds: [...currentStanceKinds], applyId: defaultWarriorStanceId(spec) };
}

// Ensure a live warrior wears exactly one stance valid for their current spec.
// A no-op for non-warriors and for a warrior already in a valid stance; on spawn
// (or a spec change that invalidates the worn stance) it strips the stale stance
// and applies the spec default. Draws no rng. Runs once per player-tick.
export function ensureWarriorStance(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (meta.cls !== 'warrior') return;
  const worn = p.auras.filter((a) => isWarriorStanceKind(a.kind)).map((a) => a.kind);
  const spec = ctx.playerMods(meta).spec;
  const plan = warriorStanceReconcile(spec, worn);
  if (plan.applyId === null) return;
  // Drop any invalid stance auras (announce the loss like the exclusive-group path).
  for (let i = p.auras.length - 1; i >= 0; i--) {
    if (plan.removeKinds.includes(p.auras[i].kind)) {
      const a = p.auras[i];
      p.auras.splice(i, 1);
      ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
    }
  }
  const aura = buildStanceAura(plan.applyId, p.id);
  if (!aura) return;
  // applyAura emits the 'aura' gained event and re-runs recalcPlayerStats, so
  // Berserker's crit-chance bonus takes effect the same tick.
  ctx.applyAura(p, aura);
}
