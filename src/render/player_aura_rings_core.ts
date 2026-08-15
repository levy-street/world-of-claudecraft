export interface PlayerAuraRingLayoutInput {
  id: string;
  visible: boolean;
  scale: number;
}

export interface PlayerAuraRingLayout {
  id: string;
  visible: boolean;
  innerRadius: number;
  outerRadius: number;
}

export type PlayerAuraOrnamentKind = 'shield' | 'triangle' | 'diamond' | 'chevron';

export interface PlayerAuraOrnamentSpec {
  kind: PlayerAuraOrnamentKind;
  count: number;
  size: number;
  angularSpeed: number;
}

export type PlayerAuraRingQualityTier = 'low' | 'medium' | 'high' | 'ultra' | 'insane';

export interface PlayerAuraRingQualityProfile {
  radialSegments: number;
  ornamentCount: number;
  glowBaseOpacity: number;
  glowPulseOpacity: number;
  ornamentBaseOpacity: number;
  ornamentPulseOpacity: number;
  coreColorGain: number;
  glowColorGain: number;
  ornamentColorGain: number;
}

const BASE_CENTER_RADIUS = 1.01;
const BASE_THICKNESS = 0.12;
const RING_RADIUS_STEP = 0.3;

const ORNAMENT_SPECS: Readonly<Record<string, PlayerAuraOrnamentSpec>> = {
  revenge_free: { kind: 'triangle', count: 5, size: 0.14, angularSpeed: -0.38 },
  battle_trance: { kind: 'chevron', count: 6, size: 0.13, angularSpeed: 0.28 },
  raised_guard: { kind: 'shield', count: 6, size: 0.16, angularSpeed: 0.18 },
  iron_resolve: { kind: 'diamond', count: 8, size: 0.13, angularSpeed: -0.16 },
  overpower_charge: { kind: 'triangle', count: 4, size: 0.18, angularSpeed: 0.42 },
  sudden_death: { kind: 'triangle', count: 10, size: 0.11, angularSpeed: -0.5 },
  victory_rush: { kind: 'shield', count: 4, size: 0.18, angularSpeed: 0.24 },
  enrage: { kind: 'chevron', count: 12, size: 0.1, angularSpeed: 0.55 },
  heating_up: { kind: 'chevron', count: 5, size: 0.13, angularSpeed: 0.34 },
  hot_streak: { kind: 'triangle', count: 8, size: 0.15, angularSpeed: 0.48 },
  fingers_of_frost: { kind: 'diamond', count: 6, size: 0.14, angularSpeed: -0.22 },
  brain_freeze: { kind: 'triangle', count: 7, size: 0.12, angularSpeed: -0.38 },
  arcane_charge: { kind: 'diamond', count: 4, size: 0.17, angularSpeed: 0.2 },
  aether_rush: { kind: 'chevron', count: 9, size: 0.11, angularSpeed: 0.46 },
  perfect_moment: { kind: 'diamond', count: 12, size: 0.1, angularSpeed: -0.18 },
};

const ORNAMENT_KINDS: readonly PlayerAuraOrnamentKind[] = [
  'shield',
  'triangle',
  'diamond',
  'chevron',
];
const GENERATED_ORNAMENTS = new Map<string, PlayerAuraOrnamentSpec>();

function hashProcId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function playerAuraOrnamentSpec(id: string): PlayerAuraOrnamentSpec {
  const handTuned = ORNAMENT_SPECS[id];
  if (handTuned) return handTuned;
  const cached = GENERATED_ORNAMENTS.get(id);
  if (cached) return cached;
  const hash = hashProcId(id);
  const direction = (hash & 1) === 0 ? 1 : -1;
  const generated = {
    kind: ORNAMENT_KINDS[(hash >>> 1) % ORNAMENT_KINDS.length],
    count: 4 + ((hash >>> 3) % 9),
    size: (10 + ((hash >>> 7) % 7)) / 100,
    angularSpeed: (direction * (16 + ((hash >>> 11) % 35))) / 100,
  };
  GENERATED_ORNAMENTS.set(id, generated);
  return generated;
}

const clampScale = (scale: number): number =>
  Number.isFinite(scale) ? Math.min(1.6, Math.max(0.65, scale)) : 1;

/**
 * Shed only cosmetic ground-ring richness by static graphics tier. The core
 * ring, its pulse, and at least three spell-specific ornaments remain visible
 * and animated on every tier. HDR gains are enabled only when a bloom composer
 * is actually present, including constrained High/Ultra profiles.
 */
export function playerAuraRingQualityProfile(
  tier: PlayerAuraRingQualityTier,
  requestedOrnaments: number,
  bloom: boolean,
): PlayerAuraRingQualityProfile {
  const ornamentCount =
    tier === 'low'
      ? Math.max(3, Math.ceil(requestedOrnaments * 0.5))
      : tier === 'medium'
        ? Math.max(3, Math.ceil(requestedOrnaments * 0.75))
        : requestedOrnaments;
  const hdr = bloom
    ? { coreColorGain: 1.8, glowColorGain: 1.35, ornamentColorGain: 2 }
    : { coreColorGain: 1, glowColorGain: 1, ornamentColorGain: 1 };
  if (tier === 'low') {
    return {
      radialSegments: 32,
      ornamentCount,
      glowBaseOpacity: 0.06,
      glowPulseOpacity: 0.03,
      ornamentBaseOpacity: 0.58,
      ornamentPulseOpacity: 0.16,
      ...hdr,
    };
  }
  if (tier === 'medium') {
    return {
      radialSegments: 48,
      ornamentCount,
      glowBaseOpacity: 0.1,
      glowPulseOpacity: 0.05,
      ornamentBaseOpacity: 0.62,
      ornamentPulseOpacity: 0.18,
      ...hdr,
    };
  }
  return {
    radialSegments: 64,
    ornamentCount,
    glowBaseOpacity: 0.16,
    glowPulseOpacity: 0.08,
    ornamentBaseOpacity: 0.68,
    ornamentPulseOpacity: 0.22,
    ...hdr,
  };
}

/**
 * Assign stable bands in configured order. The shared block scale expands every
 * radius and the gaps between bands together. Hidden rings retain their band so
 * a proc appearing or expiring never makes the other rings jump.
 */
export function planPlayerAuraRings(
  inputs: readonly PlayerAuraRingLayoutInput[],
): PlayerAuraRingLayout[] {
  return inputs.map((input, index) => {
    const scale = clampScale(input.scale);
    const centerRadius = (BASE_CENTER_RADIUS + index * RING_RADIUS_STEP) * scale;
    const halfThickness = (BASE_THICKNESS * scale) / 2;
    return {
      id: input.id,
      visible: input.visible,
      innerRadius: Math.max(0.05, centerRadius - halfThickness),
      outerRadius: centerRadius + halfThickness,
    };
  });
}
