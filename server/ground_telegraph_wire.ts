// Per-viewer ground-telegraph snapshot fragments: the anonymous ground-AoE
// warnings (frost rings, Ignivar meteor warnings, temporal hourglasses,
// consecrations) plus the Varkhul encounter block, concatenated in the exact
// order the snapshot frame carries them. The broadcast loop builds one realm
// projection per pass (each sim readout is read exactly once); this module
// then filters and serializes it once per viewer without growing the
// GameServer coordinator.

import type { ActiveIgnivarMeteorWarning } from '../src/sim/ignivar_meteors';
import type { ActiveVarkhulAnvilMeteorWarning } from '../src/sim/varkhul_anvil_meteors';
import type { ActiveVarkhulAssembly } from '../src/sim/varkhul_assembly';
import type {
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
} from '../src/sim/varkhul_cinder_orbs';
import type { ActiveVarkhulForgestormWarning } from '../src/sim/varkhul_forgestorm';
import type {
  ActiveConsecration,
  ActiveFrostRing,
  ActiveTemporalHourglass,
} from '../src/world_api';
import { type VarkhulEncounterWireWorld, varkhulEncounterWireJson } from './varkhul_wire';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface GroundTelegraphWireWorld {
  activeFrostRings: readonly ActiveFrostRing[];
  activeIgnivarMeteors: readonly ActiveIgnivarMeteorWarning[];
  activeTemporalHourglasses: readonly ActiveTemporalHourglass[];
  activeConsecrations: readonly ActiveConsecration[];
  varkhulEncounter: VarkhulEncounterWireWorld;
  // The open-world ground-AoE horizon; consecrations always scope to it, even
  // inside the battleground band.
  interestQueryRadius: number;
  // The world-event router's delivery radius; the Ignivar meteor warnings and
  // the Varkhul encounter block ride it (see the meteor filter below).
  eventRadius: number;
}

// The sim surface the projection reads: every `active*` readout builds its
// array fresh on each get, which is why the broadcast loop reads each exactly
// once per pass through groundTelegraphWorld below.
export interface GroundTelegraphWorldSource {
  activeFrostRings: readonly ActiveFrostRing[];
  activeIgnivarMeteors: readonly ActiveIgnivarMeteorWarning[];
  activeTemporalHourglasses: readonly ActiveTemporalHourglass[];
  activeConsecrations: readonly ActiveConsecration[];
  activeVarkhulForgestormWarnings: readonly ActiveVarkhulForgestormWarning[];
  activeVarkhulCinderFires: readonly ActiveVarkhulCinderFire[];
  activeVarkhulCinderOrbProjectiles: readonly ActiveVarkhulCinderOrbProjectile[];
  activeVarkhulAnvilMeteors: readonly ActiveVarkhulAnvilMeteorWarning[];
  activeVarkhulAssemblies: readonly ActiveVarkhulAssembly[];
}

// Build the once-per-broadcast realm projection shared by every viewer in the
// pass.
export function groundTelegraphWorld(
  sim: GroundTelegraphWorldSource,
  interestQueryRadius: number,
  eventRadius: number,
): GroundTelegraphWireWorld {
  return {
    activeFrostRings: sim.activeFrostRings,
    activeIgnivarMeteors: sim.activeIgnivarMeteors,
    activeTemporalHourglasses: sim.activeTemporalHourglasses,
    activeConsecrations: sim.activeConsecrations,
    varkhulEncounter: {
      activeVarkhulForgestormWarnings: sim.activeVarkhulForgestormWarnings,
      activeVarkhulCinderFires: sim.activeVarkhulCinderFires,
      activeVarkhulCinderOrbProjectiles: sim.activeVarkhulCinderOrbProjectiles,
      activeVarkhulAnvilMeteors: sim.activeVarkhulAnvilMeteors,
      activeVarkhulAssemblies: sim.activeVarkhulAssemblies,
    },
    interestQueryRadius,
    eventRadius,
  };
}

// Ground-AoE warnings (frost rings, temporal hourglasses) are anonymous
// ground effects, not entities: they carry a position, radius and timer
// and no caster identity or team, and a player must be able to react to
// one wherever it lands. They therefore keep the widened match horizon
// inside the band (`aoeBase` is the battleground drop radius there), unlike
// the enemy PLAYER records in the snapshot entity loop, whose records the
// narrowed rule holds to the open-world radii.
export function groundTelegraphWireJson(
  world: GroundTelegraphWireWorld,
  anchorPos: { x: number; z: number },
  aoeBase: number,
): string {
  const frostRings = world.activeFrostRings
    .filter((ring) => {
      const dx = ring.x - anchorPos.x;
      const dz = ring.z - anchorPos.z;
      const limit = aoeBase + ring.radius;
      return dx * dx + dz * dz <= limit * limit;
    })
    .map(
      (ring) =>
        `{"id":${JSON.stringify(ring.id)},"x":${round2(ring.x)},"z":${round2(ring.z)},"r":${round2(ring.radius)},"i":${round2(ring.innerRadius)},"dur":${round2(ring.duration)},"rem":${round2(ring.remaining)}}`,
    );
  const frostRingsJson = frostRings.length > 0 ? `,"rings":[${frostRings.join(',')}]` : '';
  const ignivarMeteors = world.activeIgnivarMeteors
    .filter((meteor) => {
      const dx = meteor.x - anchorPos.x;
      const dz = meteor.z - anchorPos.z;
      // Keep the persistent warning on the same delivery horizon as
      // its world-point meteorImpact event, so a visible warning never
      // disappears silently outside the event router's radius.
      return dx * dx + dz * dz <= world.eventRadius * world.eventRadius;
    })
    .map(
      (meteor) =>
        `{"id":${JSON.stringify(meteor.id)},"x":${round2(meteor.x)},"z":${round2(meteor.z)},"r":${round2(meteor.radius)},"dur":${round2(meteor.duration)},"rem":${round2(meteor.remaining)},"lead":${round2(meteor.warningLead)}}`,
    );
  const ignivarMeteorsJson =
    ignivarMeteors.length > 0 ? `,"ignivarMeteors":[${ignivarMeteors.join(',')}]` : '';
  const varkhulEncounterJson = varkhulEncounterWireJson(
    world.varkhulEncounter,
    anchorPos,
    world.eventRadius,
  );
  const temporalHourglasses = world.activeTemporalHourglasses
    .filter((hourglass) => {
      const dx = hourglass.x - anchorPos.x;
      const dz = hourglass.z - anchorPos.z;
      const limit = aoeBase + hourglass.radius;
      return dx * dx + dz * dz <= limit * limit;
    })
    .map(
      (hourglass) =>
        `{"id":${JSON.stringify(hourglass.id)},"x":${round2(hourglass.x)},"z":${round2(hourglass.z)},"r":${round2(hourglass.radius)},"dur":${round2(hourglass.duration)},"rem":${round2(hourglass.remaining)}}`,
    );
  const temporalHourglassesJson =
    temporalHourglasses.length > 0 ? `,"hourglasses":[${temporalHourglasses.join(',')}]` : '';
  const consecrations = world.activeConsecrations
    .filter((consecration) => {
      const dx = consecration.x - anchorPos.x;
      const dz = consecration.z - anchorPos.z;
      const limit = world.interestQueryRadius + consecration.radius;
      return dx * dx + dz * dz <= limit * limit;
    })
    .map(
      (consecration) =>
        `{"id":${JSON.stringify(consecration.id)},"x":${round2(consecration.x)},"z":${round2(consecration.z)},"r":${round2(consecration.radius)},"dur":${round2(consecration.duration)},"rem":${round2(consecration.remaining)}}`,
    );
  const consecrationsJson =
    consecrations.length > 0 ? `,"consecrations":[${consecrations.join(',')}]` : '';
  return (
    frostRingsJson +
    ignivarMeteorsJson +
    varkhulEncounterJson +
    temporalHourglassesJson +
    consecrationsJson
  );
}
