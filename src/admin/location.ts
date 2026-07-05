import { fmtNumber } from './format';
import { delveIdLabel, dungeonIdLabel, poiLabel, t, zoneIdLabel, zoneLabel } from './i18n';
import type { LivePlayerLocation } from './types';

export interface LocationInput {
  location?: LivePlayerLocation | null;
  x: number;
  z: number;
  zone?: string | null;
}

export interface LocationDisplay {
  primary: string;
  secondary: string;
  details: string[];
}

export function formatCoordinates(x: number, z: number): string {
  return `${fmtNumber(x)}, ${fmtNumber(z)}`;
}

function instanceLabel(location: LivePlayerLocation): string | null {
  if (!location.instanceId) return location.instance;
  if (location.kind === 'delve') return delveIdLabel(location.instanceId, location.instance);
  if (location.kind === 'dungeon') return dungeonIdLabel(location.instanceId, location.instance);
  return location.instance;
}

export function locationDisplay(input: LocationInput): LocationDisplay {
  const coords = formatCoordinates(input.x, input.z);
  const location = input.location ?? null;
  if (!location) {
    return {
      primary: input.zone ? zoneLabel(input.zone) : coords,
      secondary: coords,
      details: [t('location.coordinates', { value: coords })],
    };
  }

  const zone = zoneIdLabel(location.zoneId, location.zone);
  const instance = instanceLabel(location);
  const landmark =
    location.kind === 'overworld' && location.poiIndex !== null
      ? poiLabel(location.zoneId, location.poiIndex, location.poi)
      : null;
  const primary = landmark ?? instance ?? zone;
  const details = [
    t('location.type', { value: t(`location.kind.${location.kind}`) }),
    t('location.zone', { value: zone }),
  ];
  if (instance) details.push(t('location.instance', { value: instance }));
  if (location.instanceSlot !== null)
    details.push(t('location.slot', { value: location.instanceSlot }));
  if (landmark) details.push(t('location.nearest', { value: landmark }));
  if (location.poiDistance !== null)
    details.push(t('location.distance', { value: fmtNumber(location.poiDistance) }));
  details.push(t('location.coordinates', { value: coords }));

  return { primary, secondary: coords, details };
}
