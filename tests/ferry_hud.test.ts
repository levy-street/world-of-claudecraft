// @vitest-environment jsdom
//
// The ferry HUD (src/ui/hud/transport/): the pure view-core that turns the
// world's timetable view into the panel line and the hint, fed identically by
// the offline Sim and the online ClientWorld, and the thin painter that
// writes it through the elided writers. The voyage is in plain sight now
// (Phase 3), so there is no sea card over the world.

import { beforeAll, describe, expect, it } from 'vitest';

import { EASTBROOK_NIGHTBLOOM_FERRY } from '../src/sim/content/transport_ships';
import { Sim } from '../src/sim/sim';
import {
  emptyTransportFerryView,
  type TransportFerryView,
  transportFerryViewAt,
  transportVoyageSeconds,
} from '../src/sim/transport_schedule';
import { WORLD_SEED } from '../src/sim/world_seed';
import { FERRY_HUD_NEAR_YD, FerryHudPainter, ferryHudModel } from '../src/ui/hud/transport';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { bareClient } from './helpers/bare_client';

const ROUTE = EASTBROOK_NIGHTBLOOM_FERRY;
const T = ROUTE.timings;
const EAST = ROUTE.berths[0];
const DEPART = T.docked;
const ARRIVE = DEPART + transportVoyageSeconds(ROUTE, 0);

function viewAt(clock: number, passenger: boolean): TransportFerryView {
  return transportFerryViewAt(ROUTE, clock, -4.3, passenger, emptyTransportFerryView(ROUTE));
}

describe('ferryHudModel', () => {
  it('counts down on the pier, near the docked ship, with the boarding hint', () => {
    const m = ferryHudModel(viewAt(15, false), EAST.landing.x, EAST.landing.z);
    expect(m).toEqual({
      line: 'departsIn',
      destPoi: 'poi:nightbloom:moonrest',
      seconds: 45,
      hint: true,
    });
    // the last second reads as casting off
    expect(ferryHudModel(viewAt(DEPART - 0.2, false), EAST.x, EAST.z).line).toBe('departsIn');
    expect(ferryHudModel(viewAt(DEPART - 0.001, false), EAST.x, EAST.z).seconds).toBe(1);
  });

  it('says nothing far from the ship, or to a bystander once it sails', () => {
    expect(ferryHudModel(viewAt(15, false), EAST.x + FERRY_HUD_NEAR_YD + 1, EAST.z).line).toBe(
      'none',
    );
    expect(ferryHudModel(viewAt(DEPART + 1, false), EAST.x, EAST.z).line).toBe('none');
    expect(ferryHudModel(null, EAST.x, EAST.z).line).toBe('none');
  });

  it('shows a passenger the quiet sailing line the whole voyage long', () => {
    for (const clock of [DEPART + 1, (DEPART + ARRIVE) / 2, ARRIVE - 1]) {
      expect(ferryHudModel(viewAt(clock, true), 0, 0)).toEqual({
        line: 'sailing',
        destPoi: 'poi:nightbloom:moonrest',
        seconds: 0,
        hint: false,
      });
    }
    // a bystander sees nothing while it sails
    expect(ferryHudModel(viewAt((DEPART + ARRIVE) / 2, false), 0, 0).line).toBe('none');
    // bound for Moonrest on the way out, Eastbrook on the way back
    expect(ferryHudModel(viewAt(ARRIVE + T.docked + 1, true), 0, 0).destPoi).toBe(
      'poi:eastbrook_vale:eastbrook',
    );
  });

  it('reads the same from the offline Sim and the online ClientWorld', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const client = bareClient(sim.player.id);
    const apply = (s: unknown) =>
      (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(s);
    for (const clock of [12, 59.2, 63, 71, 82, 120, ARRIVE + 3, ARRIVE + 70]) {
      sim.transportClockOffset = clock - sim.time;
      apply({ t: 'snap', time: clock, ents: [] });
      const offline = ferryHudModel(sim.ferryView(), EAST.landing.x, EAST.landing.z);
      const online = ferryHudModel(client.ferryView(), EAST.landing.x, EAST.landing.z);
      expect(online).toEqual(offline);
    }
  });
});

/** Applies every write, so the assertions can read the resulting DOM. */
function writers(): PainterHostWriters {
  return {
    setText: (el, text) => {
      el.textContent = text;
    },
    setDisplay: (el, display) => {
      el.style.display = display;
    },
    setTransform: () => {},
    setWidth: (el, width) => {
      el.style.width = width;
    },
    setStyleProp: (el, prop, value) => {
      el.style.setProperty(prop, value);
    },
    toggleClass: (el, cls, on) => {
      el.classList.toggle(cls, on);
    },
    setAttr: (el, attr, value) => {
      if (value === null) el.removeAttribute(attr);
      else el.setAttribute(attr, value);
    },
  };
}

describe('FerryHudPainter', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('builds nothing until there is something to show', () => {
    const mount = document.createElement('div');
    const painter = new FerryHudPainter(writers(), () => mount);
    painter.update(viewAt(15, false), undefined);
    // the default player position (0, 0) is far from the ship
    expect(mount.children).toHaveLength(0);
  });

  it('paints the countdown on the pier, then the sailing line aboard, and no sea card', () => {
    const host = document.createElement('div');
    const mount = document.createElement('div');
    host.append(mount);
    const painter = new FerryHudPainter(writers(), () => mount);
    const player = { pos: { x: EAST.landing.x, y: 0, z: EAST.landing.z } } as never;
    painter.update(viewAt(15, false), player);
    const root = mount.querySelector<HTMLElement>('#ferry-hud');
    if (!root) throw new Error('not built');
    expect(root.getAttribute('role')).toBe('status');
    expect(root.style.display).toBe('flex');
    expect(root.textContent).toContain('The ferry to Moonrest departs in 0:45');
    expect(root.textContent).toContain('The crossing is free.');
    painter.update(viewAt(DEPART + 40, true), player);
    expect(root.textContent).toContain('Sailing to Moonrest');
    // nothing covers the world: the voyage is in sight
    expect(host.querySelector('#ferry-sea-card')).toBeNull();
    // docked at Moonrest and far from it: the panel hides
    painter.update(viewAt(ARRIVE + 5, false), player);
    expect(root.style.display).toBe('none');
  });
});
