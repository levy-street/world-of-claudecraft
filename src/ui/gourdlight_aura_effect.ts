// What Gourdlight Eve's encounter auras DO, for their buff/debuff hover tooltip. A pure
// descriptor like the rest of aura_effect.ts (which calls this first): it returns a
// hudChrome.auraEffect.gourdlight.* key plus the raw numbers, read off the same
// constants the fight runs on (THATCHGRIN_KIT.puppet, the boss template's mechanic
// level scale), so the copy cannot drift from combat.
// Pinned by tests/gourdlight_scarecrow_puppet.test.ts.

import {
  THATCHBOUND_AURA_IDS,
  THATCHGRIN_ID,
  THATCHGRIN_KIT,
} from '../sim/content/gourdlight_eve_scarecrow';
import { MOBS } from '../sim/data';
import type { AuraEffectDescriptor, AuraEffectInput } from './aura_effect';

const KEY = 'hudChrome.auraEffect.gourdlight';
const THATCHBOUND: ReadonlySet<string> = new Set(THATCHBOUND_AURA_IDS);

/** The Gourdlight Eve aura's descriptor, or null when `a` is not one of them. */
export function gourdlightAuraEffectDescriptor(a: AuraEffectInput): AuraEffectDescriptor | null {
  if (a.id === undefined || a.kind !== 'incapacitate' || !THATCHBOUND.has(a.id)) return null;
  const p = THATCHGRIN_KIT.puppet;
  const scale = MOBS[THATCHGRIN_ID]?.mechanicLevelScale;
  return {
    key: `${KEY}.thatchbound`,
    nums: {
      every: p.swing.every,
      min: p.swing.min,
      max: p.swing.max,
      mult: scale?.toMult ?? 1,
      level: scale?.toLevel ?? 0,
      pct: Math.round(p.breakShare * 100),
    },
  };
}
