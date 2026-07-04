// The Envoys' Hall flow (src/sim/envoys.ts + content/valdris/envoys.ts): every
// character starts UNSWORN, swears a one-shot faction-and-race oath in person at
// the hall from level 18, is carried to their realm hub, and travels the ferry
// network afterwards. All rules are server-authoritative re-checks, so this
// suite drives them straight on the Sim facade the way a forged client would.

import { describe, expect, it } from 'vitest';
import { ENVOY_HALL_Z } from '../src/sim/content/valdris/envoys';
import { ZONES, zoneAt } from '../src/sim/data';
import { ENVOY_CHOICE_MIN_LEVEL } from '../src/sim/envoys';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;

function makeSim(): AnySim {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function teleport(sim: AnySim, x: number, z: number): void {
  const e = sim.player;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

const atHall = (sim: AnySim) => teleport(sim, 0, ENVOY_HALL_Z - 2);

describe('the Envoys Hall oath', () => {
  it('is refused away from the hall, under-level, for junk races, and when already sworn', () => {
    const sim = makeSim();
    sim.setPlayerLevel(ENVOY_CHOICE_MIN_LEVEL);
    // away from any envoy
    expect(sim.chooseRace('dwarf')).toBe(false);
    // at the hall but under-leveled
    const low = makeSim();
    atHall(low);
    expect(low.chooseRace('dwarf')).toBe(false);
    expect(low.meta(low.playerId)!.race).toBeUndefined();
    // junk race at the hall, leveled
    atHall(sim);
    expect(sim.chooseRace('dragon_god')).toBe(false);
    expect(sim.meta(sim.playerId)!.race).toBeUndefined();
    // a real oath succeeds exactly once
    expect(sim.chooseRace('dwarf')).toBe(true);
    expect(sim.meta(sim.playerId)!.race).toBe('dwarf');
    expect(sim.chooseRace('elf')).toBe(false); // permanent
    expect(sim.meta(sim.playerId)!.race).toBe('dwarf');
  });

  it('swears the oath and carries the chooser to their faction realm hub', () => {
    const cases: Array<[string, string]> = [
      ['dwarf', 'kael_empire'],
      ['dark_fae', 'veth_confederation'],
      ['sand_mage', 'ossara_domain'],
    ];
    for (const [race, zoneId] of cases) {
      const sim = makeSim();
      sim.setPlayerLevel(20);
      atHall(sim);
      sim.events.length = 0;
      expect(sim.chooseRace(race)).toBe(true);
      const e = sim.player;
      expect(zoneAt(e.pos.z).id).toBe(zoneId);
      const hub = ZONES.find((z) => z.id === zoneId)!.hub;
      expect(Math.hypot(e.pos.x - hub.x, e.pos.z - hub.z)).toBeLessThan(hub.radius + 5);
      // prevPos moved with the teleport (no world-sweep next tick)
      expect(e.prevPos.z).toBeCloseTo(e.pos.z, 5);
      expect(
        sim.events.some((ev: any) => ev.type === 'log' && /sworn your oath/.test(ev.text)),
      ).toBe(true);
    }
  });

  it('ferries the sworn home and out again, and points the unsworn at the oath', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    atHall(sim);
    expect(sim.chooseRace('gnome')).toBe(true); // lands at Kaelspire
    // realm ferry carries anyone sworn back to the hall
    teleport(sim, 6, 1780 - 1); // beside Coach Master Aldwin
    expect(sim.travel()).toBe(true);
    expect(Math.abs(sim.player.pos.z - (ENVOY_HALL_Z - 8))).toBeLessThan(3);
    // the OWN envoy carries them out again
    teleport(sim, -5, ENVOY_HALL_Z - 1); // beside Envoy Marcus Vale (Kael)
    expect(sim.travel()).toBe(true);
    expect(zoneAt(sim.player.pos.z).id).toBe('kael_empire');
    // a foreign envoy refuses passage
    const other = makeSim();
    other.setPlayerLevel(20);
    atHall(other);
    expect(other.chooseRace('nomad')).toBe(true); // Ossara
    teleport(other, -5, ENVOY_HALL_Z - 1); // Kael envoy
    expect(other.travel()).toBe(false);
    // unsworn at an envoy: pointed at the oath, not teleported
    const fresh = makeSim();
    atHall(fresh);
    const before = fresh.player.pos.z;
    expect(fresh.travel()).toBe(false);
    expect(fresh.player.pos.z).toBeCloseTo(before, 5);
    // nowhere near any passage NPC
    teleport(fresh, 0, 300);
    expect(fresh.travel()).toBe(false);
  });

  it('keeps the oath across a save/load round-trip', () => {
    const sim = makeSim();
    sim.setPlayerLevel(20);
    atHall(sim);
    expect(sim.chooseRace('frost_kin')).toBe(true);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.race).toBe('frost_kin');
    const sim2 = makeSim();
    const pid2 = (sim2 as AnySim).addPlayer('warrior', 'Back', { state });
    expect(sim2.meta(pid2)!.race).toBe('frost_kin');
  });
});
