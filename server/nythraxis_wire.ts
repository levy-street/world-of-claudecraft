// Viewer-scoped Nythraxis mechanic snapshot fragment: Grave Eruption warnings,
// Grave Flame and Soulfire patches, Gravefire lines, and Binding Sigils. The
// broadcast loop supplies one prebuilt realm projection (each sim readout read
// exactly once per pass in ground_telegraph_wire.ts); this module filters and
// serializes it once per viewer without growing the GameServer coordinator.
// Sibling of varkhul_wire.ts, same shape.

import type { ActiveNythraxisBindingSigil } from '../src/sim/nythraxis_binding_sigil';
import type {
  ActiveNythraxisGraveEruption,
  ActiveNythraxisGraveFlame,
} from '../src/sim/nythraxis_grave_eruption';
import type { ActiveNythraxisGravefire } from '../src/sim/nythraxis_gravefire';

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
  activeNythraxisGravefires: readonly ActiveNythraxisGravefire[];
  activeNythraxisBindingSigils: readonly ActiveNythraxisBindingSigil[];
}

// All families ride the world-event delivery radius, the horizon the Ignivar
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
        `{"id":${JSON.stringify(flame.id)},"src":${flame.sourceId},"k":${JSON.stringify(flame.kind)},"x":${round2(flame.x)},"z":${round2(flame.z)},"r":${round2(flame.radius)},"dur":${round2(flame.duration)},"rem":${round2(flame.remaining)}}`,
    );
  const gravefires = world.activeNythraxisGravefires
    .filter((fire) => inRange(fire, anchor, eventRadius))
    .map(
      (fire) =>
        `{"id":${JSON.stringify(fire.id)},"src":${fire.sourceId},"x":${round2(fire.x)},"z":${round2(fire.z)},"dx":${round2(fire.dirX)},"dz":${round2(fire.dirZ)},"tail":${round2(fire.tail)},"head":${round2(fire.head)},"hw":${round2(fire.halfWidth)},"rem":${round2(fire.remaining)}}`,
    );
  const sigils = world.activeNythraxisBindingSigils
    .filter((sigil) => inRange(sigil, anchor, eventRadius))
    .map(
      (sigil) =>
        `{"id":${JSON.stringify(sigil.id)},"src":${sigil.sourceId},"x":${round2(sigil.x)},"z":${round2(sigil.z)},"r":${round2(sigil.radius)},"dur":${round2(sigil.duration)},"rem":${round2(sigil.remaining)}}`,
    );
  const eruptionsJson =
    eruptions.length > 0 ? `,"nythraxisEruptions":[${eruptions.join(',')}]` : '';
  const flamesJson = flames.length > 0 ? `,"nythraxisFlames":[${flames.join(',')}]` : '';
  const gravefiresJson =
    gravefires.length > 0 ? `,"nythraxisGravefires":[${gravefires.join(',')}]` : '';
  const sigilsJson = sigils.length > 0 ? `,"nythraxisSigils":[${sigils.join(',')}]` : '';
  return eruptionsJson + flamesJson + gravefiresJson + sigilsJson;
}
