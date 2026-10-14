// The map's fixed ferry landings and selected-port timetable. Pure and
// DOM-free: the map supplies the shared schedule clock, never a wall clock.
import { TRANSPORT_ROUTES } from '../sim/content/transport_ships';
import { transportPhaseAt, transportVoyageSeconds } from '../sim/transport_schedule';
import { clockSeconds } from './clock_seconds_core';
import { poiMarkLabel } from './entity_i18n';
import { esc } from './esc';
import { t } from './i18n';

export interface FerryPort {
  readonly kind: 'ferry-port';
  readonly routeId: string;
  readonly berthId: string;
  readonly zoneId: string;
  readonly x: number;
  readonly z: number;
}

export type FerryPortMapMarker = FerryPort & { mx: number; my: number };

/** Marker positions are on the boarding pier, rather than the ship or town. */
export const FERRY_PORTS: readonly FerryPort[] = Object.freeze(
  TRANSPORT_ROUTES.flatMap((route) =>
    route.berths.map((berth) =>
      Object.freeze({
        kind: 'ferry-port' as const,
        routeId: route.id,
        berthId: berth.id,
        zoneId: berth.poi.split(':')[1],
        x: berth.landing.x,
        z: berth.landing.z,
      }),
    ),
  ),
);

function resolvePort(routeId: string, berthId: string) {
  const route = TRANSPORT_ROUTES.find((candidate) => candidate.id === routeId);
  if (!route) return null;
  const index = route.berths.findIndex((berth) => berth.id === berthId);
  if (index < 0) return null;
  return { route, index, berth: route.berths[index], destination: route.berths[1 - index] };
}

export interface FerryPortSchedule {
  boarding: boolean;
  /** Zero while boarding is open; otherwise the wait until this pier opens. */
  arrivalSeconds: number;
  /** Always the next departure from the selected pier, including return travel. */
  departureSeconds: number;
}

export function ferryPortSchedule(
  routeId: string,
  berthId: string,
  clock: number | null,
): FerryPortSchedule | null {
  const port = resolvePort(routeId, berthId);
  if (!port || clock === null || !Number.isFinite(clock)) return null;
  const { route, index } = port;
  const phase = transportPhaseAt(route, clock);
  if (phase.phase === 'docked' && phase.berth === index) {
    return { boarding: true, arrivalSeconds: 0, departureSeconds: phase.remaining };
  }
  const arrivalSeconds =
    phase.phase === 'docked'
      ? phase.remaining + transportVoyageSeconds(route, phase.from)
      : phase.to === index
        ? phase.remaining
        : phase.remaining + route.timings.docked + transportVoyageSeconds(route, phase.to);
  return {
    boarding: false,
    arrivalSeconds,
    departureSeconds: arrivalSeconds + route.timings.docked,
  };
}

export function ferryPortLabel(routeId: string, berthId: string): string {
  const port = resolvePort(routeId, berthId);
  if (!port) return '';
  return t('hudChrome.ferry.portLabel', {
    port: poiMarkLabel(port.berth.poi) ?? '',
    dest: poiMarkLabel(port.destination.poi) ?? '',
  });
}

function countdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${clockSeconds(Math.floor(whole / 60), false)}:${clockSeconds(whole % 60, true)}`;
}

interface FerryPortTooltipLine {
  className: 'tt-title' | 'tt-sub' | 'tt-green' | 'tt-desc';
  text: string;
}

/** One localized timetable supplies both the visual and accessible surfaces. */
export function ferryPortTooltipLines(
  routeId: string,
  berthId: string,
  clock: number | null,
): FerryPortTooltipLine[] {
  const port = resolvePort(routeId, berthId);
  if (!port) return [];
  const dest = poiMarkLabel(port.destination.poi) ?? '';
  const lines: FerryPortTooltipLine[] = [
    {
      className: 'tt-title',
      text: t('hudChrome.ferry.portTitle', { port: poiMarkLabel(port.berth.poi) ?? '' }),
    },
    { className: 'tt-sub', text: t('hudChrome.ferry.destination', { dest }) },
  ];
  const schedule = ferryPortSchedule(routeId, berthId, clock);
  if (!schedule) {
    lines.push({ className: 'tt-sub', text: t('hudChrome.ferry.scheduleUnavailable') });
    return lines;
  }
  lines.push(
    schedule.boarding
      ? { className: 'tt-green', text: t('hudChrome.ferry.boardNow') }
      : {
          className: 'tt-sub',
          text: t('hudChrome.ferry.arrivesIn', { time: countdown(schedule.arrivalSeconds) }),
        },
    {
      className: 'tt-sub',
      text: t('hudChrome.ferry.departsIn', { dest, time: countdown(schedule.departureSeconds) }),
    },
    { className: 'tt-desc', text: t('hudChrome.ferry.boardHint') },
  );
  return lines;
}

export function ferryPortSummary(routeId: string, berthId: string, clock: number | null): string {
  return ferryPortTooltipLines(routeId, berthId, clock)
    .map((line) => line.text)
    .join('. ');
}

/** All localized text is escaped after interpolation, including POI names. */
export function ferryPortTooltipHtml(
  routeId: string,
  berthId: string,
  clock: number | null,
): string {
  return ferryPortTooltipLines(routeId, berthId, clock)
    .map((line) => `<div class="${line.className}">${esc(line.text)}</div>`)
    .join('');
}
