import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from '../src/sim/entity';
import type { WorldPvpZonePolicy } from '../src/sim/pvp/world_pvp_rules';
import * as zones from '../src/sim/pvp/world_pvp_zones';
import { Sim } from '../src/sim/sim';
import { makeWriterFacet } from '../src/ui/painter_host';
import { type PvpRiskWorld, playerPvpRisk } from '../src/ui/pvp_risk_core';
import { newUnitFrameBuffer, unitFrameViewInto } from '../src/ui/unit_frame';
import { UnitFramePainter } from '../src/ui/unit_frame_painter';
import { bareClient } from './helpers/bare_client';
import { FakeDocument } from './helpers/fake_dom';

afterEach(() => vi.restoreAllMocks());

function world(zone: WorldPvpZonePolicy = 'contested'): PvpRiskWorld {
  vi.spyOn(zones, 'worldPvpZonePolicyAt').mockReturnValue(zone);
  return {
    player: createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Player'),
    worldPvpInfo: null,
    duelInfo: null,
    arenaInfo: null,
    bgInfo: null,
  };
}

describe('self PvP risk', () => {
  it.each(['contested', 'sanctuary', 'ffa'] as const)(
    'uses %s ground and the live flag',
    (zone) => {
      const w = world(zone);
      expect(playerPvpRisk(w)).toBe(zone === 'ffa');
      w.player.pvpFlag = true;
      expect(playerPvpRisk(w)).toBe(zone !== 'sanctuary');
    },
  );

  it('keeps warning throughout disarming and clears only when the entity flag drops', () => {
    const w = world();
    w.player.pvpFlag = true;
    w.worldPvpInfo = { enabled: true, disarmRemaining: 0 } as PvpRiskWorld['worldPvpInfo'];
    expect(playerPvpRisk(w)).toBe(true);
    w.player.pvpFlag = false;
    expect(playerPvpRisk(w)).toBe(false);
  });

  it('follows live boundary crossings rather than stale snapshot zone', () => {
    const w = world('ffa');
    w.worldPvpInfo = { enabled: true, zone: 'sanctuary' } as PvpRiskWorld['worldPvpInfo'];
    expect(playerPvpRisk(w)).toBe(true);
    vi.mocked(zones.worldPvpZonePolicyAt).mockReturnValue('sanctuary');
    expect(playerPvpRisk(w)).toBe(false);
    expect(zones.worldPvpZonePolicyAt).toHaveBeenLastCalledWith(w.player.pos.x, w.player.pos.z);
  });

  it('updates at real sanctuary and free-for-all borders', () => {
    const w = world();
    vi.restoreAllMocks();
    w.player.pvpFlag = true;
    w.player.pos.x = 0;
    w.player.pos.z = 179;
    expect(playerPvpRisk(w)).toBe(false);
    w.player.pos.z = 181;
    expect(playerPvpRisk(w)).toBe(true);
    w.player.pvpFlag = false;
    w.player.pos.x = 404;
    w.player.pos.z = 1819;
    expect(playerPvpRisk(w)).toBe(false);
    w.player.pos.z = 1821;
    expect(playerPvpRisk(w)).toBe(true);
  });

  it.each(['duelInfo', 'arenaInfo', 'bgInfo'] as const)(
    'warns only during active %s combat',
    (key) => {
      const w = world('sanctuary');
      w.worldPvpInfo = { enabled: false } as PvpRiskWorld['worldPvpInfo'];
      for (const state of ['countdown', 'active', 'over']) {
        Object.assign(w, { [key]: key === 'duelInfo' ? { state } : { match: { state } } });
        expect(playerPvpRisk(w)).toBe(state === 'active');
      }
    },
  );

  it('suppresses disabled-realm and corpse warnings but includes prison brawls', () => {
    const w = world('ffa');
    w.worldPvpInfo = { enabled: false } as PvpRiskWorld['worldPvpInfo'];
    expect(playerPvpRisk(w)).toBe(false);
    w.player.jailed = true;
    expect(playerPvpRisk(w)).toBe(true);
    w.player.dead = true;
    expect(playerPvpRisk(w)).toBe(false);
  });

  it('agrees for offline Sim and online ClientWorld inputs without a nameplate', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const client = bareClient(sim.playerId);
    client.entities.set(sim.playerId, sim.player);
    sim.player.pos.x = 500;
    sim.player.pos.z = 500;
    expect(zones.worldPvpZonePolicyAt(500, 500)).toBe('contested');
    for (const flag of [false, true, false]) {
      sim.player.pvpFlag = flag;
      expect(playerPvpRisk(sim)).toBe(flag);
      expect(playerPvpRisk(client)).toBe(flag);
    }
  });
});

describe('self PvP risk surfaces', () => {
  it('paints both surfaces, elides identical frames, and clears when safety returns', () => {
    const document = new FakeDocument();
    const element = () => document.createElement('div') as unknown as HTMLElement;
    const badge = element();
    const minimap = element();
    let writes = 0;
    const facet = makeWriterFacet(
      new Map(),
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => writes++,
      () => {},
    );
    const painter = new UnitFramePainter(facet, {
      frame: element(),
      level: element(),
      hpFill: element(),
      pvpRisk: { badge, minimap },
    });
    const buffer = newUnitFrameBuffer();
    const descriptor = {
      present: true,
      hpFrac: 1,
      hpText: '',
      resourceKind: 'none' as const,
      resFrac: 0,
      resText: '',
      levelText: null,
      name: 'Player',
      portraitKey: '',
      absorb: null,
      dead: false,
      outOfRange: false,
      pvpRisk: true,
    };
    painter.paint(unitFrameViewInto(buffer, descriptor));
    expect(badge.style.display).toBe('inline-flex');
    expect(minimap.classList.contains('pvp-risk')).toBe(true);
    writes = 0;
    painter.paint(unitFrameViewInto(buffer, descriptor));
    expect(writes).toBe(0);
    descriptor.pvpRisk = false;
    painter.paint(unitFrameViewInto(buffer, descriptor));
    expect(badge.style.display).toBe('none');
    expect(minimap.classList.contains('pvp-risk')).toBe(false);
    expect(writes).toBe(2);
    writes = 0;
    painter.paint(unitFrameViewInto(buffer, descriptor));
    expect(writes).toBe(0);
  });

  it('connects the self risk decision to both shipped HUD surfaces', () => {
    const hud = readFileSync('src/ui/hud.ts', 'utf8');
    expect(hud).toContain('playerFrame.pvpRisk = playerPvpRisk(sim)');
    expect(hud).toContain("pvpRisk: { badge: $('#pf-pvp'), minimap: $('#minimap-disc') }");
    for (const entry of ['index.html', 'play.html']) {
      expect(readFileSync(entry, 'utf8')).toMatch(
        /id="pf-pvp"[^>]*data-i18n="hudChrome.pvp.mobileLabel"/,
      );
    }
    const css = readFileSync('src/styles/hud.css', 'utf8');
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*?#minimap-disc.pvp-risk::after\s*{\s*animation: none/,
    );
  });
});
