// Viewer-scoped Nythraxis mechanic snapshot fragment: the Grave Eruption
// warning rings and the Grave Flame patches they leave behind. The broadcast
// loop supplies one prebuilt realm projection (each sim readout read exactly
// once per pass in ground_telegraph_wire.ts); this module filters and
// serializes it once per viewer without growing the GameServer coordinator.
// Sibling of varkhul_wire.ts, same shape.

import type {
  ActiveNythraxisGraveEruption,
  ActiveNythraxisGraveFlame,
} from '../src/sim/nythraxis_grave_eruption';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function inRange(
  point: { x: number; z: number },
  anchor: { x: number; z: number },
  radius: number,
): boolean {
  const dx = point.x - anchor.x;
  const dz = point.z - anchor.z;
  return dx * dx + dz * dz <= radius * radius;
}

export interface NythraxisEncounterWireWorld {
  activeNythraxisGraveEruptions: readonly ActiveNythraxisGraveEruption[];
  activeNythraxisGraveFlames: readonly ActiveNythraxisGraveFlame[];
}

// Both families ride the world-event delivery radius, the horizon the Ignivar
// meteor warnings use: a warning a player can see must never vanish silently
// because it sits past the entity interest radius, and the flame a warning
// turns into must stay visible on the same horizon.
export function nythraxisEncounterWireJson(
  world: NythraxisEncounterWireWorld,
  anchor: { x: number; z: number },
  eventRadius: number,
): string {
  const eruptions = world.activeNythraxisGraveEruptions
    .filter((eruption) => inRange(eruption, anchor, eventRadius))
    .map(
      (eruption) =>
        `{"id":${JSON.stringify(eruption.id)},"x":${round2(eruption.x)},"z":${round2(eruption.z)},"r":${round2(eruption.radius)},"dur":${round2(eruption.duration)},"rem":${round2(eruption.remaining)},"lead":${round2(eruption.warningLead)}}`,
    );
  const flames = world.activeNythraxisGraveFlames
    .filter((flame) => inRange(flame, anchor, eventRadius))
    .map(
      (flame) =>
        `{"id":${JSON.stringify(flame.id)},"src":${flame.sourceId},"x":${round2(flame.x)},"z":${round2(flame.z)},"r":${round2(flame.radius)},"dur":${round2(flame.duration)},"rem":${round2(flame.remaining)}}`,
    );
  const eruptionsJson =
    eruptions.length > 0 ? `,"nythraxisEruptions":[${eruptions.join(',')}]` : '';
  const flamesJson = flames.length > 0 ? `,"nythraxisFlames":[${flames.join(',')}]` : '';
  return eruptionsJson + flamesJson;
}
