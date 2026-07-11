// Single source of truth for "is this aura a debuff?" — shared by the HUD buff/
// debuff split and the sim's /targetbuffs aura tagging. Host-agnostic (no DOM, no
// i18n), so it lives in src/sim/ and both src/ui/hud.ts and src/sim/sim.ts import
// it. Keeping ONE classifier avoids the drift where the HUD treated silence/disarm/
// blind/etc. as debuffs but /targetbuffs (a narrower set) tagged them as buffs.
import type { AuraKind } from './types';

// A kind that is harmful by nature regardless of its value. Mirrors classic-era
// "Debuff" framing: damage-over-time, crowd control, stat/armor reductions, and
// the various combat penalties (silence/disarm/blind/lockout/expose/...).
const HARMFUL_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'dot',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'attackspeed',
  'debuff_ap',
  'sunder',
  'corrode',
  'faerie_fire',
  'mortal_wound',
  'silence',
  'disarm',
  'blind',
  'expose',
  'spellvuln',
  'lockout',
  'vulnerability',
  'hex',
  'tongues',
  'cost_tax',
  'heal_absorb',
  'critvuln',
]);

// A negative-value stat aura (e.g. a mob's Withering Wail sapping attack power, or
// an Intellect-draining curse) is a debuff even though it reuses a buff_* kind.
export function isDebuffAura(kind: AuraKind, value: number): boolean {
  return HARMFUL_AURA_KINDS.has(kind) || (kind.startsWith('buff_') && value < 0);
}
