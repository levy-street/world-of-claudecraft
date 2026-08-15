import type { SimEvent } from '../sim/types';

export interface WarlockMeteorSpawn {
  x: number;
  z: number;
  radius: number;
  duration: number;
  sourceId?: number;
  densityScale?: number;
}

export interface RainMeteorSchedule {
  at: number;
  x: number;
  z: number;
  fallDuration: number;
  rockScale: number;
  impactRadius: number;
  eventRadius: number;
  sourceId?: number;
  seed: number;
}

export interface RainMeteorPlan {
  count: number;
  duration: number;
  pending: RainMeteorSchedule[];
}

export interface WarlockMeteorSink {
  spawnRain(spawn: WarlockMeteorSpawn): void;
  spawnInfernal(spawn: WarlockMeteorSpawn): void;
  stopRain(sourceId: number): void;
}

type PointSpellfxEvent = Extract<SimEvent, { type: 'spellfxAt' }>;

export function warlockMeteorDensityScale(tier: string): number {
  return tier === 'low' ? 0.55 : 1;
}

export function routeWarlockMeteorSpellfxAt(
  event: PointSpellfxEvent,
  sink: WarlockMeteorSink,
  densityScale = 1,
): boolean {
  if (event.fx === 'felMeteorRain') {
    sink.spawnRain({
      x: event.x,
      z: event.z,
      radius: event.radius ?? 7,
      duration: event.duration ?? 6,
      sourceId: event.sourceId,
      densityScale,
    });
    return true;
  }
  if (event.fx === 'felMeteorRainStop') {
    if (event.sourceId !== undefined) sink.stopRain(event.sourceId);
    return true;
  }
  if (event.fx === 'felMeteorFall') {
    sink.spawnInfernal({
      x: event.x,
      z: event.z,
      radius: event.radius ?? 6,
      duration: event.duration ?? 1.2,
      sourceId: event.sourceId,
    });
    return true;
  }
  return false;
}

export function felMeteorHash01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function planRainMeteorShower(spawn: WarlockMeteorSpawn): RainMeteorPlan {
  const duration = Math.max(0.1, spawn.duration);
  const fullCount = Math.min(40, Math.max(24, Math.round(duration * 5.5)));
  const densityScale = Math.max(0.4, Math.min(1, spawn.densityScale ?? 1));
  const count = Math.max(14, Math.round(fullCount * densityScale));
  const seed = (spawn.sourceId ?? 1) * 17 + Math.round(spawn.x * 31) + Math.round(spawn.z * 47);
  const pending: RainMeteorSchedule[] = [];

  for (let index = 0; index < count; index++) {
    const angle = felMeteorHash01(seed + index * 5.17) * Math.PI * 2;
    const distance = Math.sqrt(felMeteorHash01(seed + index * 7.31 + 2)) * spawn.radius * 0.9;
    const x = spawn.x + Math.cos(angle) * distance;
    const z = spawn.z + Math.sin(angle) * distance;
    const rockScale = 0.24 + felMeteorHash01(seed + index * 11.9) * 0.24;
    const fallDuration = 0.48 + felMeteorHash01(seed + index * 13.7) * 0.34;
    pending.push({
      at: (index / count) * Math.max(0.05, duration - fallDuration),
      x,
      z,
      fallDuration,
      rockScale,
      impactRadius: 0.65 + rockScale * 1.8,
      eventRadius: spawn.radius,
      sourceId: spawn.sourceId,
      seed: seed + index * 19,
    });
  }

  pending.sort((a, b) => a.at - b.at || a.seed - b.seed);
  return { count, duration, pending };
}
