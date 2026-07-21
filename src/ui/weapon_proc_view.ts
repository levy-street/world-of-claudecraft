// Pure view-core for the legendary weapon-proc tooltip block. Maps an item's
// `weaponProcs` (the sim-side "chance on action" data, see src/sim/combat/
// equip_procs.ts) into flat, host-agnostic descriptors the HUD renders through
// t(). DOM-free and deterministic so a Vitest can pin the derived numbers (the
// dot/hot totals and the attack-slow percent) without a browser.
import type { WeaponProc, WeaponProcEffect } from '../sim/types';

export interface WeaponProcEffectDesc {
  kind: WeaponProcEffect['kind'];
  // The proc's own name labels the chain arc; dot/hot/attackSlow carry their own.
  name?: string;
  school?: string;
  damage?: number; // chainArc primary-hit damage
  jumps?: number; // chainArc extra targets
  slowPct?: number; // attackSlow: (mult - 1) rounded to whole percent
  total?: number; // dot/hot: perTick summed over the whole duration
  duration?: number; // attackSlow/dot/hot seconds
}

export interface WeaponProcLine {
  trigger: WeaponProc['trigger'];
  chancePct: number; // chance (0..1) as a whole percent
  effects: WeaponProcEffectDesc[];
}

// Total ticks a periodic effect fires over its duration (inclusive-safe: an
// 8s/2s dot ticks 4 times). Guards a zero interval so bad data can't divide by 0.
function periodicTotal(perTick: number, interval: number, duration: number): number {
  const ticks = interval > 0 ? Math.round(duration / interval) : 0;
  return perTick * ticks;
}

function describeEffect(effect: WeaponProcEffect, procName: string): WeaponProcEffectDesc {
  switch (effect.kind) {
    case 'chainArc':
      return {
        kind: 'chainArc',
        name: procName,
        school: effect.school,
        damage: effect.damage,
        jumps: effect.jumps,
      };
    case 'attackSlow':
      return {
        kind: 'attackSlow',
        name: effect.name,
        slowPct: Math.round((effect.mult - 1) * 100),
        duration: effect.duration,
      };
    case 'dot':
      return {
        kind: 'dot',
        name: effect.name,
        school: effect.school,
        total: periodicTotal(effect.perTick, effect.interval, effect.duration),
        duration: effect.duration,
      };
    case 'hot':
      return {
        kind: 'hot',
        name: effect.name,
        total: periodicTotal(effect.perTick, effect.interval, effect.duration),
        duration: effect.duration,
      };
  }
}

// One display line per proc: the trigger (hit / damaging spell / heal), the
// chance, and the ordered effect descriptors. Empty for an item with no procs.
export function weaponProcLines(procs: WeaponProc[] | undefined): WeaponProcLine[] {
  if (!procs?.length) return [];
  return procs.map((proc) => ({
    trigger: proc.trigger,
    chancePct: Math.round(proc.chance * 100),
    effects: proc.effects.map((effect) => describeEffect(effect, proc.name)),
  }));
}
