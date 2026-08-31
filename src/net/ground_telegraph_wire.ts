// Strict snapshot decoders for the persistent ground-telegraph rows the
// server ships each snapshot: frost rings, Ignivar meteor warnings, Varkhul
// Forgestorm warnings, temporal hourglasses, and consecrations. Every field
// is re-validated and a malformed row is DROPPED rather than rendered, so a
// version-skewed frame never puts undefined into the world view.

import type { ActiveIgnivarMeteorWarning } from '../sim/ignivar_meteors';
import type { ActiveVarkhulForgestormWarning } from '../sim/varkhul_forgestorm';
import type {
  ActiveConsecration,
  ActiveFrostRing,
  ActiveTemporalHourglass,
} from '../world_api/combat';

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
