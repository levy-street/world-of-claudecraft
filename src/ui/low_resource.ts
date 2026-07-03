// Pure derivation of the low-resource warning state for the player resource
// bar. Classic-era clients pulse the mana bar when power runs low; we extend that to
// energy as well. Rage is intentionally excluded — it *builds* in combat, so a
// low value is a normal state, not a warning.
//
// Kept UI-framework-free (no DOM) so the thresholds/bands can be snapshot
// tested directly, mirroring xp_bar.ts. All display strings route through t().

import type { ResourceType } from '../sim/types';
import { t } from './i18n';

export interface LowResourceInput {
  resource: number;
  maxResource: number;
  resourceType: ResourceType | null;
}

export interface LowResourceView {
  active: boolean; // warning visible
  opacity: number; // 0..1 glow strength, intensifies toward empty
  pulseSeconds: number; // breathe period; shorter = more urgent
  label: string; // "Low Mana" / "Low Energy" ('' when inactive)
}

// Warn once the bar drops below a quarter full.
export const LOW_RESOURCE_THRESHOLD = 0.25;

export function lowResourceView(input: LowResourceInput): LowResourceView {
  const { resource, maxResource, resourceType } = input;
  const inactive: LowResourceView = { active: false, opacity: 0, pulseSeconds: 0, label: '' };

  // Only mana/energy warn; rage and resource-less/degenerate frames are silent.
  if (maxResource <= 0) return inactive;
  if (resourceType !== 'mana' && resourceType !== 'energy') return inactive;

  const frac = clamp01(resource / maxResource);
  if (frac >= LOW_RESOURCE_THRESHOLD) return inactive;

  // t: 0 at the threshold, 1 at empty.
  const tt = clamp01((LOW_RESOURCE_THRESHOLD - frac) / LOW_RESOURCE_THRESHOLD);
  // Ease the glow in (matches the low-health vignette feel) and keep a floor so
  // it's visible the instant it crosses the threshold.
  const opacity = 0.4 + tt ** 0.8 * 0.55;
  // Breathe slowly when just-low (~1.4s), urgently when near-empty (~0.5s).
  const pulseSeconds = 1.4 - tt * 0.9;
  const label = resourceType === 'mana' ? t('game.hud.lowMana') : t('game.hud.lowEnergy');

  return { active: true, opacity, pulseSeconds, label };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
