// DEV-ONLY (ALLOW_DEV_COMMANDS) Cascada temporal manual-playtest tooling. Isolated
// from production: every entry point here is reached ONLY from the /dev cascade
// command (Sim.startCascadePlaytest) or from a hook guarded by an active session
// (Entity.cascadeDevStats, set only by that command), so a realm without dev
// commands never runs a line of it. The metrics are pure observation: they never
// feed a gameplay decision, never ride the wire, and never touch rng.
//
// `src/sim`-pure: imports only sibling sim types (no DOM/Three/render/ui/game/net,
// no Math.random/Date.now/performance.now), enforced by tests/architecture.test.ts.

import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';

// Scenario geometry: a primary/center ally plus additional allies at these KNOWN
// distances (yards) from the center. Four sit inside the 15 yd Cascada radius; the
// last is deliberately OUTSIDE it, so the manual playtest shows the radius cutoff and
// the five-target cap. The mage stands back near the training dummy.
export const CASCADE_SCENARIO = {
  centerFromMage: 3, // center ally, kept CLOSE so the mage->center line of sight is clear
  dummyFromMage: 4, // training dummy, just in front of the mage (arcane damage source)
  allyDistances: [4, 8, 11, 14, 20] as const, // from the center; 20 is beyond 15
  radius: 15,
  allyHpFraction: 0.35, // reduced health so converted heals visibly land
} as const;

/** Accumulate the mage's effective Arcane damage. No-op unless a session is active. */
export function recordCascadeDamage(caster: Entity, dealt: number): void {
  if (caster.cascadeDevStats) caster.cascadeDevStats.arcaneDamage += dealt;
}

/** Accumulate one Echo conversion heal and its clamped overheal (session only). */
export function recordCascadeConversion(caster: Entity, applied: number, overheal: number): void {
  const s = caster.cascadeDevStats;
  if (!s) return;
  s.convertedHeal += Math.max(0, applied);
  s.convertedOverheal += Math.max(0, overheal);
}

/** Accumulate one Cascada initial per-target heal (session only). */
export function recordCascadeInitial(caster: Entity, applied: number): void {
  if (caster.cascadeDevStats) caster.cascadeDevStats.initialHeal += Math.max(0, applied);
}

function fmt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Emit the per-cast playtest readout to the caster (dev channel). No-op unless a
 * session is active. `initialApplied` is the initial heal that actually landed on
 * each target, index-aligned with `targets`. Logs, per target: id, distance to the
 * scenario center, echo type (group 13% vs a kept individual 35%), and the initial
 * heal; then a running line with total damage/DPS, healing/HPS, converted healing,
 * overheal, and mana. All since the /dev cascade session began.
 */
export function logCascadeCast(
  ctx: SimContext,
  caster: Entity,
  targets: Entity[],
  initialApplied: number[],
): void {
  const s = caster.cascadeDevStats;
  if (!s) return;
  const center = ctx.entities.get(s.centerId) ?? targets[0];
  const line = (text: string) => ctx.emit({ type: 'log', text, pid: caster.id });
  line(`[cascade] cast selected ${targets.length} target(s):`);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const d = center ? dist2d(t.pos, center.pos) : 0;
    const echo = t.auras.find((a) => a.kind === 'temporal_echo' && a.sourceId === caster.id);
    const kind = echo?.echoGroup === false ? 'individual 35%' : 'group 13%';
    line(`  - id ${t.id}: dist ${fmt(d)}y, ${kind}, initialHeal ${initialApplied[i] ?? 0}`);
  }
  const elapsed = Math.max(1e-3, ctx.time - s.startTime);
  const heal = s.convertedHeal + s.initialHeal;
  line(
    `[cascade] totals @ ${fmt(elapsed)}s: dmg ${fmt(s.arcaneDamage)} (DPS ${fmt(s.arcaneDamage / elapsed)}), ` +
      `heal ${fmt(heal)} (HPS ${fmt(heal / elapsed)}), converted ${fmt(s.convertedHeal)}, ` +
      `overheal ${fmt(s.convertedOverheal)}, mana ${Math.round(caster.resource)}/${caster.maxResource}`,
  );
}
