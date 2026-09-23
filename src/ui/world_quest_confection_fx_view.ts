export interface WorldQuestConfectionFxProfile {
  readonly tier: 'match' | 'bright' | 'splendid' | 'grand';
  readonly sparksPerCell: number;
  readonly sparkBudget: number;
  readonly sparkDuration: number;
  readonly sparkDistance: number;
  readonly sparkSize: number;
  readonly burstScale: number;
  readonly rings: number;
  readonly rays: number;
}

const PROFILES: readonly WorldQuestConfectionFxProfile[] = [
  {
    tier: 'match',
    sparksPerCell: 5,
    sparkBudget: 48,
    sparkDuration: 620,
    sparkDistance: 38,
    sparkSize: 7,
    burstScale: 1.6,
    rings: 0,
    rays: 0,
  },
  {
    tier: 'bright',
    sparksPerCell: 7,
    sparkBudget: 56,
    sparkDuration: 680,
    sparkDistance: 48,
    sparkSize: 8,
    burstScale: 2,
    rings: 0,
    rays: 0,
  },
  {
    tier: 'splendid',
    sparksPerCell: 10,
    sparkBudget: 64,
    sparkDuration: 880,
    sparkDistance: 70,
    sparkSize: 10,
    burstScale: 2.8,
    rings: 1,
    rays: 6,
  },
  {
    tier: 'grand',
    sparksPerCell: 12,
    sparkBudget: 72,
    sparkDuration: 1050,
    sparkDistance: 100,
    sparkSize: 12,
    burstScale: 3.4,
    rings: 2,
    rays: 12,
  },
];

/** Total resolved clears include candies removed at the same cell in later cascades. */
export function worldQuestConfectionFxProfile(cleared: number): WorldQuestConfectionFxProfile {
  return PROFILES[cleared >= 8 ? 3 : cleared >= 5 ? 2 : cleared >= 4 ? 1 : 0];
}

export interface WorldQuestConfectionSparkPoint {
  readonly offset: number;
  readonly opacity: number;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
}

/** Cosmetic paths: a curling match scatter, or a fountain arc that rises and settles. */
export function worldQuestConfectionSparkPath(
  dx: number,
  dy: number,
  index: number,
  fountain: boolean,
): WorldQuestConfectionSparkPoint[] {
  const distance = Math.max(1, Math.hypot(dx, dy));
  const curl = (index % 2 === 0 ? 1 : -1) * (fountain ? 18 : 9);
  const offsets = [0, 0.12, 0.28, 0.5, 0.74, 1];
  const opacities = [0, 0.86, 1, 0.78, 0.42, 0];
  const scales = [0.12, 0.82, 1, 0.76, 0.4, 0.08];
  return offsets.map((offset, step) => {
    const bend = Math.sin(offset * Math.PI) * curl;
    return {
      offset,
      opacity: opacities[step],
      x: dx * offset + (fountain ? bend : (-dy / distance) * bend),
      y: fountain
        ? dy * 4 * offset * (1 - offset) + 64 * offset * offset
        : dy * offset + (dx / distance) * bend + 18 * offset * offset,
      scale: scales[step],
      rotation: (index % 4) * 12 + offset * (fountain ? 165 : 115),
    };
  });
}
