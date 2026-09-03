// Strict snapshot decoders for the persistent ground-telegraph rows the
// server ships each snapshot: frost rings, Ignivar meteor warnings, Varkhul
// Forgestorm warnings, Nythraxis Grave Eruption warnings and Grave Flames,
// temporal hourglasses, and consecrations. Every field is re-validated and a
// malformed row is DROPPED rather than rendered, so a version-skewed frame
// never puts undefined into the world view. `applyGroundTelegraphSnapshot`
// at the bottom is the one call ClientWorld.applySnapshot makes for the whole
// family (the Varkhul cinder and assembly decoders live in their own siblings
// and are composed here).

import type { ActiveIgnivarMeteorWarning } from '../sim/ignivar_meteors';
import type {
  ActiveNythraxisGraveEruption,
  ActiveNythraxisGraveFlame,
} from '../sim/nythraxis_grave_eruption';
import type { ActiveVarkhulForgestormWarning } from '../sim/varkhul_forgestorm';
import type {
  ActiveConsecration,
  ActiveFrostRing,
  ActiveTemporalHourglass,
  ActiveVarkhulAnvilMeteorWarning,
  ActiveVarkhulAssembly,
  ActiveVarkhulCinderFire,
  ActiveVarkhulCinderOrbProjectile,
} from '../world_api/combat';
import { decodeVarkhulAnvilMeteors, decodeVarkhulAssemblies } from './varkhul_assembly_wire';
import {
  decodeVarkhulCinderFires,
  decodeVarkhulCinderOrbProjectiles,
} from './varkhul_cinder_orb_wire';

export function decodeFrostRings(value: unknown): ActiveFrostRing[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown): ActiveFrostRing[] => {
    if (!value || typeof value !== 'object') return [];
    const ring = value as Record<string, unknown>;
    if (
      typeof ring.id !== 'string' ||
      ![ring.x, ring.z, ring.r, ring.i, ring.dur, ring.rem].every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      ) ||
      (ring.r as number) <= 0 ||
      (ring.i as number) < 0 ||
      (ring.i as number) >= (ring.r as number) ||
      (ring.dur as number) <= 0 ||
      (ring.rem as number) <= 0
    )
      return [];
    return [
      {
        id: ring.id,
        x: ring.x as number,
        z: ring.z as number,
        radius: ring.r as number,
        innerRadius: ring.i as number,
        duration: ring.dur as number,
        remaining: Math.min(ring.rem as number, ring.dur as number),
      },
    ];
  });
}

export function decodeIgnivarMeteors(value: unknown): ActiveIgnivarMeteorWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown): ActiveIgnivarMeteorWarning[] => {
    if (!value || typeof value !== 'object') return [];
    const meteor = value as Record<string, unknown>;
    if (
      typeof meteor.id !== 'string' ||
      ![meteor.x, meteor.z, meteor.r, meteor.dur, meteor.rem, meteor.lead].every(
        (entry) => typeof entry === 'number' && Number.isFinite(entry),
      ) ||
      (meteor.r as number) <= 0 ||
      (meteor.dur as number) <= 0 ||
      (meteor.rem as number) <= 0 ||
      (meteor.lead as number) < 0 ||
      (meteor.lead as number) >= (meteor.dur as number)
    ) {
      return [];
    }
    return [
      {
        id: meteor.id,
        x: meteor.x as number,
        z: meteor.z as number,
        radius: meteor.r as number,
        duration: meteor.dur as number,
        remaining: Math.min(meteor.rem as number, meteor.dur as number),
        warningLead: meteor.lead as number,
      },
    ];
  });
}

// The Nythraxis Grave Eruption warning ring: the meteor row shape under the
// `nythraxisEruptions` key, validated exactly like the Ignivar meteors.
export function decodeNythraxisGraveEruptions(value: unknown): ActiveNythraxisGraveEruption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown): ActiveNythraxisGraveEruption[] => {
    if (!value || typeof value !== 'object') return [];
    const eruption = value as Record<string, unknown>;
    if (
      typeof eruption.id !== 'string' ||
      ![eruption.x, eruption.z, eruption.r, eruption.dur, eruption.rem, eruption.lead].every(
        (entry) => typeof entry === 'number' && Number.isFinite(entry),
      ) ||
      (eruption.r as number) <= 0 ||
      (eruption.dur as number) <= 0 ||
      (eruption.rem as number) <= 0 ||
      (eruption.lead as number) < 0 ||
      (eruption.lead as number) >= (eruption.dur as number)
    ) {
      return [];
    }
    return [
      {
        id: eruption.id,
        x: eruption.x as number,
        z: eruption.z as number,
        radius: eruption.r as number,
        duration: eruption.dur as number,
        remaining: Math.min(eruption.rem as number, eruption.dur as number),
        warningLead: eruption.lead as number,
      },
    ];
  });
}

// The Grave Flame patch an eruption leaves behind (`nythraxisFlames`): a
// timed ground circle attributed to its boss through `src`.
export function decodeNythraxisGraveFlames(value: unknown): ActiveNythraxisGraveFlame[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown): ActiveNythraxisGraveFlame[] => {
    if (!value || typeof value !== 'object') return [];
    const flame = value as Record<string, unknown>;
    if (
      typeof flame.id !== 'string' ||
      ![flame.src, flame.x, flame.z, flame.r, flame.dur, flame.rem].every(
        (entry) => typeof entry === 'number' && Number.isFinite(entry),
      ) ||
      (flame.r as number) <= 0 ||
      (flame.dur as number) <= 0 ||
      (flame.rem as number) <= 0
    ) {
      return [];
    }
    return [
      {
        id: flame.id,
        sourceId: flame.src as number,
        x: flame.x as number,
        z: flame.z as number,
        radius: flame.r as number,
        duration: flame.dur as number,
        remaining: Math.min(flame.rem as number, flame.dur as number),
      },
    ];
  });
}

export function decodeVarkhulForgestormWarnings(value: unknown): ActiveVarkhulForgestormWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown): ActiveVarkhulForgestormWarning[] => {
    if (!value || typeof value !== 'object') return [];
    const warning = value as Record<string, unknown>;
    if (
      typeof warning.id !== 'string' ||
      ![
        warning.sourceId,
        warning.x,
        warning.z,
        warning.r,
        warning.dur,
        warning.rem,
        warning.lead,
      ].every((entry) => typeof entry === 'number' && Number.isFinite(entry)) ||
      (warning.sourceId as number) < 0 ||
      (warning.r as number) <= 0 ||
      (warning.dur as number) <= 0 ||
      (warning.rem as number) <= 0 ||
      (warning.lead as number) < 0 ||
      (warning.lead as number) >= (warning.dur as number)
    ) {
      return [];
    }
    return [
      {
        id: warning.id,
        sourceId: warning.sourceId as number,
        x: warning.x as number,
        z: warning.z as number,
        radius: warning.r as number,
        duration: warning.dur as number,
        remaining: Math.min(warning.rem as number, warning.dur as number),
        warningLead: warning.lead as number,
      },
    ];
  });
}

export function decodeTemporalHourglasses(value: unknown): ActiveTemporalHourglass[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown): ActiveTemporalHourglass[] => {
    if (!value || typeof value !== 'object') return [];
    const hourglass = value as Record<string, unknown>;
    if (
      typeof hourglass.id !== 'string' ||
      ![hourglass.x, hourglass.z, hourglass.r, hourglass.dur, hourglass.rem].every(
        (entry) => typeof entry === 'number' && Number.isFinite(entry),
      ) ||
      (hourglass.r as number) <= 0 ||
      (hourglass.dur as number) <= 0 ||
      (hourglass.rem as number) <= 0
    )
      return [];
    return [
      {
        id: hourglass.id,
        x: hourglass.x as number,
        z: hourglass.z as number,
        radius: hourglass.r as number,
        duration: hourglass.dur as number,
        remaining: Math.min(hourglass.rem as number, hourglass.dur as number),
      },
    ];
  });
}

export function decodeConsecrations(value: unknown): ActiveConsecration[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((value: unknown): ActiveConsecration[] => {
    if (!value || typeof value !== 'object') return [];
    const consecration = value as Record<string, unknown>;
    if (
      typeof consecration.id !== 'string' ||
      ![consecration.x, consecration.z, consecration.r, consecration.dur, consecration.rem].every(
        (entry) => typeof entry === 'number' && Number.isFinite(entry),
      ) ||
      (consecration.r as number) <= 0 ||
      (consecration.dur as number) <= 0 ||
      (consecration.rem as number) <= 0
    )
      return [];
    return [
      {
        id: consecration.id,
        x: consecration.x as number,
        z: consecration.z as number,
        radius: consecration.r as number,
        duration: consecration.dur as number,
        remaining: Math.min(consecration.rem as number, consecration.dur as number),
      },
    ];
  });
}

// The IWorld combat-facet arrays the ground-telegraph snapshot families land
// on. ClientWorld satisfies it structurally with its own field declarations,
// so the IWorld member names stay on the world (the parity pin reads them
// there) while the decode block lives here.
export interface GroundTelegraphSnapshotSink {
  activeFrostRings: ActiveFrostRing[];
  activeIgnivarMeteors: ActiveIgnivarMeteorWarning[];
  activeNythraxisGraveEruptions: ActiveNythraxisGraveEruption[];
  activeNythraxisGraveFlames: ActiveNythraxisGraveFlame[];
  activeVarkhulForgestormWarnings: ActiveVarkhulForgestormWarning[];
  activeVarkhulCinderFires: ActiveVarkhulCinderFire[];
  activeVarkhulCinderOrbProjectiles: ActiveVarkhulCinderOrbProjectile[];
  activeVarkhulAnvilMeteors: ActiveVarkhulAnvilMeteorWarning[];
  activeVarkhulAssemblies: ActiveVarkhulAssembly[];
  activeTemporalHourglasses: ActiveTemporalHourglass[];
  activeConsecrations: ActiveConsecration[];
}

// Decode every ground-telegraph family of one snapshot frame onto the sink.
// These rows are NOT delta-gated: the server re-sends the full visible set
// every frame and omits the key when nothing is visible, so an absent key
// clears the family (unlike the heavy self fields, which keep their prior
// value when omitted).
export function applyGroundTelegraphSnapshot(
  sink: GroundTelegraphSnapshotSink,
  snap: Readonly<Record<string, unknown>>,
): void {
  sink.activeFrostRings = decodeFrostRings(snap.rings);
  sink.activeIgnivarMeteors = decodeIgnivarMeteors(snap.ignivarMeteors);
  sink.activeNythraxisGraveEruptions = decodeNythraxisGraveEruptions(snap.nythraxisEruptions);
  sink.activeNythraxisGraveFlames = decodeNythraxisGraveFlames(snap.nythraxisFlames);
  sink.activeVarkhulForgestormWarnings = decodeVarkhulForgestormWarnings(snap.varkhulForgestorm);
  sink.activeVarkhulCinderFires = decodeVarkhulCinderFires(snap.varkhulCinderFires);
  sink.activeVarkhulCinderOrbProjectiles = decodeVarkhulCinderOrbProjectiles(
    snap.varkhulCinderOrbs,
  );
  sink.activeVarkhulAnvilMeteors = decodeVarkhulAnvilMeteors(snap.varkhulAnvilMeteors);
  sink.activeVarkhulAssemblies = decodeVarkhulAssemblies(snap.varkhulAssemblies);
  sink.activeTemporalHourglasses = decodeTemporalHourglasses(snap.hourglasses);
  sink.activeConsecrations = decodeConsecrations(snap.consecrations);
}
