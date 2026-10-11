import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSPORT_ROUTES } from '../src/sim/content/transport_ships';
import {
  transportBerthOpenAt,
  transportCycleSeconds,
  transportPhaseAt,
  transportVoyageSeconds,
} from '../src/sim/transport_schedule';
import * as entityI18n from '../src/ui/entity_i18n';
import {
  FERRY_PORTS,
  ferryPortLabel,
  ferryPortSchedule,
  ferryPortSummary,
  ferryPortTooltipHtml,
} from '../src/ui/ferry_port_map_core';
import { setLanguage } from '../src/ui/i18n';

afterEach(() => {
  vi.restoreAllMocks();
  setLanguage('en');
});

describe('ferry map port content', () => {
  it('includes both landing piers of every route with their owning POI zone', () => {
    expect(FERRY_PORTS).toHaveLength(4);
    for (const route of TRANSPORT_ROUTES) {
      for (const berth of route.berths) {
        expect(FERRY_PORTS.find((port) => port.berthId === berth.id)).toEqual({
          kind: 'ferry-port',
          routeId: route.id,
          berthId: berth.id,
          zoneId: berth.poi.split(':')[1],
          x: berth.landing.x,
          z: berth.landing.z,
        });
      }
    }
    expect(Object.isFrozen(FERRY_PORTS)).toBe(true);
    expect(FERRY_PORTS.every(Object.isFrozen)).toBe(true);
  });

  it('labels the port and its destination in both directions on both routes', () => {
    const expected = [
      ['eastbrook', 'Eastbrook', 'Moonrest'],
      ['nightbloom', 'Moonrest', 'Eastbrook'],
      ['wickharbor', 'Wickharbor', 'Wyrmwatch'],
      ['drakelands', 'Wyrmwatch', 'Wickharbor'],
    ];
    for (const [berthId, name, dest] of expected) {
      const port = FERRY_PORTS.find((candidate) => candidate.berthId === berthId)!;
      expect(ferryPortLabel(port.routeId, berthId)).toBe(`${name} ferry to ${dest}`);
      const html = ferryPortTooltipHtml(port.routeId, berthId, 0);
      expect(html).toContain(`${name} ferry port`);
      expect(html).toContain(`Destination: ${dest}`);
    }
  });
});

describe.each(TRANSPORT_ROUTES)('$id selected-port timetable', (route) => {
  const docked = route.timings.docked;
  const outbound = transportVoyageSeconds(route, 0);
  const inbound = transportVoyageSeconds(route, 1);
  const cycle = transportCycleSeconds(route);
  // Samples in every phase, with independent expected waits for A and B.
  const samples = [
    {
      clock: 13,
      boarding: 0,
      arrivals: [0, docked - 13 + outbound],
      departures: [docked - 13, 2 * docked - 13 + outbound],
    },
    {
      clock: docked + 9,
      boarding: -1,
      arrivals: [outbound - 9 + docked + inbound, outbound - 9],
      departures: [outbound - 9 + 2 * docked + inbound, outbound - 9 + docked],
    },
    {
      clock: docked + outbound + 17,
      boarding: 1,
      arrivals: [docked - 17 + inbound, 0],
      departures: [2 * docked - 17 + inbound, docked - 17],
    },
    {
      clock: 2 * docked + outbound + 11,
      boarding: -1,
      arrivals: [inbound - 11, inbound - 11 + docked + outbound],
      departures: [inbound - 11 + docked, inbound - 11 + 2 * docked + outbound],
    },
  ];

  it.each(samples)("shows this port's next departure at clock $clock", (sample) => {
    for (const [index, berth] of route.berths.entries()) {
      const view = ferryPortSchedule(route.id, berth.id, sample.clock)!;
      expect(view.boarding).toBe(sample.boarding === index);
      expect(view.arrivalSeconds).toBeCloseTo(sample.arrivals[index], 8);
      expect(view.departureSeconds).toBeCloseTo(sample.departures[index], 8);
      // Countdown endpoints agree with the real boarding gate, not merely
      // with a parallel formatter's arithmetic.
      if (!view.boarding) {
        expect(transportBerthOpenAt(route, index, sample.clock + view.arrivalSeconds - 0.001)).toBe(
          false,
        );
        expect(transportBerthOpenAt(route, index, sample.clock + view.arrivalSeconds + 0.001)).toBe(
          true,
        );
      }
      expect(transportBerthOpenAt(route, index, sample.clock + view.departureSeconds - 0.001)).toBe(
        true,
      );
      expect(transportBerthOpenAt(route, index, sample.clock + view.departureSeconds + 0.001)).toBe(
        false,
      );
    }
  });

  it('matches boarding at every exact phase boundary', () => {
    for (const clock of [0, docked, docked + outbound, 2 * docked + outbound, cycle]) {
      for (const [index, berth] of route.berths.entries()) {
        expect(ferryPortSchedule(route.id, berth.id, clock)?.boarding).toBe(
          transportBerthOpenAt(route, index, clock),
        );
      }
    }
  });

  it('wraps many cycles and negative clocks without changing either port schedule', () => {
    for (const berth of route.berths) {
      for (const sample of samples) {
        const expected = ferryPortSchedule(route.id, berth.id, sample.clock)!;
        for (const cycles of [-4, -1, 1, 8]) {
          const actual = ferryPortSchedule(route.id, berth.id, sample.clock + cycles * cycle)!;
          expect(actual.boarding).toBe(expected.boarding);
          expect(actual.arrivalSeconds).toBeCloseTo(expected.arrivalSeconds, 8);
          expect(actual.departureSeconds).toBeCloseTo(expected.departureSeconds, 8);
        }
      }
    }
  });

  it('shows board now only at the current pier and rounds the countdown up', () => {
    const [a, b] = route.berths;
    const html = ferryPortTooltipHtml(route.id, a.id, docked - 0.25);
    expect(html).toContain('Board now');
    expect(html).toContain('departs in 0:01');
    expect(html).not.toContain('arrives in');
    const away = ferryPortTooltipHtml(route.id, b.id, docked - 0.25);
    expect(away).not.toContain('Board now');
    expect(away).toContain('Ferry arrives in');
    expect(away).toContain('departs in');
    const returned = ferryPortTooltipHtml(route.id, a.id, cycle - 0.25);
    expect(returned).toContain('Ferry arrives in 0:01');
    expect(returned).toContain('departs in 1:01');
    expect(transportPhaseAt(route, cycle - 0.25).phase).toBe('sailing');
  });
});

describe('ferry map tooltip safety', () => {
  it('provides the same live timetable in a plain text accessible summary', () => {
    const route = TRANSPORT_ROUTES[0];
    const berth = route.berths[0];
    const docked = ferryPortSummary(route.id, berth.id, 59.75);
    expect(docked).toContain('Eastbrook ferry port');
    expect(docked).toContain('Destination: Moonrest');
    expect(docked).toContain('Board now');
    expect(docked).toContain('departs in 0:01');
    expect(docked).toContain('Stand on its deck when it sails. The crossing is free.');
    expect(docked).not.toContain('<div');
    const arriving = ferryPortSummary(route.id, berth.id, transportCycleSeconds(route) - 0.25);
    expect(arriving).toContain('Ferry arrives in 0:01');
    expect(arriving).toContain('departs in 1:01');
    expect(arriving).not.toContain('Board now');
    expect(ferryPortSummary(route.id, berth.id, null)).toContain('Ferry timetable unavailable.');
    expect(ferryPortSummary('missing', berth.id, 0)).toBe('');
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
    'omits live boarding and countdowns for clock %s',
    (clock) => {
      const port = FERRY_PORTS[0];
      expect(ferryPortSchedule(port.routeId, port.berthId, clock)).toBeNull();
      const html = ferryPortTooltipHtml(port.routeId, port.berthId, clock);
      expect(html).toContain('Ferry timetable unavailable.');
      expect(html).toContain('Destination:');
      expect(html).not.toContain('Board now');
      expect(html).not.toContain('departs in');
      expect(html).not.toContain('arrives in');
    },
  );

  it('escapes port and destination names in every tooltip line', () => {
    vi.spyOn(entityI18n, 'poiMarkLabel').mockReturnValue('<img src="bad">&\'');
    const port = FERRY_PORTS[0];
    const html = ferryPortTooltipHtml(port.routeId, port.berthId, 0);
    expect(html).not.toContain('<img');
    expect(html.match(/&lt;img src=&quot;bad&quot;&gt;&amp;&#39;/g)).toHaveLength(3);
  });

  it('ignores stale or unknown port identities', () => {
    expect(ferryPortLabel('missing', 'eastbrook')).toBe('');
    expect(ferryPortTooltipHtml(TRANSPORT_ROUTES[0].id, 'missing', 0)).toBe('');
    expect(ferryPortSchedule('missing', 'missing', 0)).toBeNull();
  });
});
