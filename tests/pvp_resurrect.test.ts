// PvP Resurrect (src/sim/pvp/pvp_resurrect.ts, src/sim/spirit.ts pvpResurrect):
// a death a hostile player had a hand in offers a raise at the graveyard Release
// picks, at full health and mana with no Keeper's Toll. Pinned here end to end:
// the pure rule, the offer stamped by a real world PvP death, the raise, every
// refusal, the self-wire round trip to the ClientWorld mirror, and the death
// screen's view core.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { BUILTIN_WORLD, DUNGEON_X_THRESHOLD } from '../src/sim/data';
import { PVP_RESURRECT_WINDOW_SECONDS, pvpResurrectEarned } from '../src/sim/pvp';
import { WORLD_PVP_TOGGLE_COOLDOWN, worldPvpOnPlayerDeath } from '../src/sim/pvp/world_pvp';
import { WORLD_PVP_ASSIST_WINDOW } from '../src/sim/pvp/world_pvp_rules';
import { RESURRECTION_SICKNESS_ID } from '../src/sim/resurrection';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { createDeathPromptView, updateDeathPromptView } from '../src/ui/hud/death';
import { bareClient } from './helpers/bare_client';

const ARENA_FREE_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function world(): Sim {
  return new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, world: ARENA_FREE_WORLD });
}

function ent(sim: Sim, pid: number): Entity {
  return sim.entities.get(pid) as Entity;
}

/** Two flagged level-20 fighters side by side on contested open ground. */
function duelists(sim: Sim): { killer: number; victim: number } {
  const killer = sim.addPlayer('warrior', 'Killer', { autoEquip: true });
  const victim = sim.addPlayer('mage', 'Victim', { autoEquip: true });
  for (const pid of [killer, victim]) {
    sim.setPlayerLevel(20, pid);
    const e = ent(sim, pid);
    e.hp = e.maxHp;
    e.resource = e.maxResource;
    e.pos = { ...ent(sim, killer).pos, x: ent(sim, killer).pos.x + (pid === victim ? 2 : 0) };
    e.prevPos = { ...e.pos };
  }
  (sim as unknown as { time: number }).time += WORLD_PVP_TOGGLE_COOLDOWN + 1;
  sim.setWorldPvpFlag(true, killer);
  sim.setWorldPvpFlag(true, victim);
  expect(sim.isHostileTo(ent(sim, killer), ent(sim, victim)), 'the pair is hostile').toBe(true);
  return { killer, victim };
}

function slay(sim: Sim, killerPid: number, victimPid: number): void {
  const victim = ent(sim, victimPid);
  sim.ctx.dealDamage(ent(sim, killerPid), victim, victim.hp + 1_000, false, 'physical', 'X', 'hit');
}

describe('pvpResurrectEarned: the pure rule', () => {
  const base = {
    killedByHostilePlayer: false,
    secondsSincePlayerHit: null,
    onInstancePlane: false,
    jailed: false,
  };

  it('offers it to a hostile player kill or a hostile hit inside the window', () => {
    expect(PVP_RESURRECT_WINDOW_SECONDS).toBe(10);
    // The window reads the World PvP hit books, which prune anything older than
    // the assist window: a longer resurrect window would silently read as this one.
    expect(PVP_RESURRECT_WINDOW_SECONDS).toBeLessThanOrEqual(WORLD_PVP_ASSIST_WINDOW);
    expect(pvpResurrectEarned({ ...base, killedByHostilePlayer: true })).toBe(true);
    expect(pvpResurrectEarned({ ...base, secondsSincePlayerHit: 10 })).toBe(true);
    expect(pvpResurrectEarned({ ...base, secondsSincePlayerHit: 10.05 })).toBe(false);
    expect(pvpResurrectEarned(base)).toBe(false);
  });

  it('never offers it on the instance plane or to a prisoner, whoever killed them', () => {
    const pvp = { ...base, killedByHostilePlayer: true, secondsSincePlayerHit: 0 };
    expect(pvpResurrectEarned({ ...pvp, onInstancePlane: true })).toBe(false);
    expect(pvpResurrectEarned({ ...pvp, jailed: true })).toBe(false);
  });
});

describe('PvP Resurrect in the Sim', () => {
  it('a world PvP death offers it, and the raise stands up at the graveyard Release picks', () => {
    const sim = world();
    const { killer, victim } = duelists(sim);
    slay(sim, killer, victim);
    const v = ent(sim, victim);
    expect(v.dead).toBe(true);
    expect(v.pvpResurrect).toBe(true);

    // The control: the same death in a twin world, then a plain Release.
    const twin = world();
    const pair = duelists(twin);
    slay(twin, pair.killer, pair.victim);
    twin.releaseSpirit(pair.victim);
    const graveyard = ent(twin, pair.victim).pos;

    sim.pvpResurrect(victim);
    expect(v.dead).toBe(false);
    expect(v.ghost).toBe(false);
    expect(v.pos.x).toBeCloseTo(graveyard.x, 5);
    expect(v.pos.z).toBeCloseTo(graveyard.z, 5);
    expect(v.hp).toBe(v.maxHp);
    expect(v.resource).toBe(v.maxResource);
    expect(v.auras.some((a) => a.id === RESURRECTION_SICKNESS_ID)).toBe(false);
    expect(v.pvpResurrect, 'the offer belonged to that death').toBe(false);
  });

  it('a death with no hostile player in it offers nothing, and the raise is refused', () => {
    const sim = world();
    const pid = sim.addPlayer('warrior', 'Alone');
    sim.setPlayerLevel(20, pid);
    const e = ent(sim, pid);
    sim.ctx.dealDamage(null, e, e.hp + 1_000, false, 'physical', 'Fall', 'hit');
    expect(e.dead).toBe(true);
    expect(e.pvpResurrect).not.toBe(true);
    sim.pvpResurrect(pid);
    expect(e.dead).toBe(true);
  });

  it('a hostile hit inside the window counts even when something else lands the kill', () => {
    const sim = world();
    const { killer, victim } = duelists(sim);
    const v = ent(sim, victim);
    sim.ctx.dealDamage(ent(sim, killer), v, 5, false, 'physical', 'Slam', 'hit');
    (sim as unknown as { time: number }).time += PVP_RESURRECT_WINDOW_SECONDS - 1;
    sim.ctx.dealDamage(null, v, v.hp + 1_000, false, 'physical', 'Fall', 'hit');
    expect(v.dead).toBe(true);
    expect(v.pvpResurrect).toBe(true);
  });

  it('never takes back an earned offer when the death hook runs again on the corpse', () => {
    const sim = world();
    const { killer, victim } = duelists(sim);
    slay(sim, killer, victim);
    const v = ent(sim, victim);
    expect(v.pvpResurrect).toBe(true);
    // A second pass with no killer and the hit books already cleared.
    worldPvpOnPlayerDeath(sim.ctx, v, null);
    expect(v.pvpResurrect).toBe(true);
  });

  it('a revive outside reviveAt (battleground seating) cannot carry the offer into a later death', () => {
    const sim = world();
    const { killer, victim } = duelists(sim);
    slay(sim, killer, victim);
    const v = ent(sim, victim);
    expect(v.pvpResurrect).toBe(true);
    // The queue pops while the PvP corpse lies there: the battleground seat
    // revives through readyArenaFighter, never spirit.ts reviveAt.
    sim.ctx.readyArenaFighter(v, { clearPrep: true });
    v.ghost = false;
    expect(v.dead).toBe(false);
    // Back in the open world, a fall kills them with no player in it.
    (sim as unknown as { time: number }).time += PVP_RESURRECT_WINDOW_SECONDS + 1;
    sim.ctx.dealDamage(null, v, v.hp + 1_000, false, 'physical', 'Fall', 'hit');
    expect(v.dead).toBe(true);
    expect(v.pvpResurrect, 'the new death decides its own offer').toBe(false);
    sim.pvpResurrect(victim);
    expect(v.dead, 'and the server refuses the raise').toBe(true);
  });

  it('refuses a ghost: a released spirit cannot take it where it stands', () => {
    const sim = world();
    const { killer, victim } = duelists(sim);
    slay(sim, killer, victim);
    sim.releaseSpirit(victim);
    const v = ent(sim, victim);
    expect(v.ghost).toBe(true);
    sim.pvpResurrect(victim);
    expect(v.dead).toBe(true);
    expect(v.ghost).toBe(true);
  });

  it('refuses a corpse on the instance plane and a jailed corpse, even with the offer set', () => {
    for (const bar of ['instance', 'jail'] as const) {
      const sim = world();
      const { killer, victim } = duelists(sim);
      slay(sim, killer, victim);
      const v = ent(sim, victim);
      expect(v.pvpResurrect).toBe(true);
      if (bar === 'instance') v.pos = { ...v.pos, x: DUNGEON_X_THRESHOLD + 50 };
      else v.jailed = true;
      sim.pvpResurrect(victim);
      expect(v.dead, bar).toBe(true);
    }
  });
});

describe('PvP Resurrect on the authoritative server', () => {
  function fakeWs() {
    const sent: string[] = [];
    return { sent, ws: { readyState: 1, send: (raw: string) => sent.push(raw) } };
  }

  function lastSelf(sent: string[]): Record<string, unknown> | null {
    for (let i = sent.length - 1; i >= 0; i--) {
      const msg = JSON.parse(sent[i]);
      if (msg.t === 'snap' && msg.self) return msg.self;
    }
    return null;
  }

  it('ships the offer on the self record, mirrors it, and raises on the pvp_resurrect command', () => {
    const server = new GameServer();
    const fc = fakeWs();
    const session = server.join(fc.ws as never, 1, 1, 'Fallen', 'warrior', null);
    if ('error' in session) throw new Error(session.error);
    const e = server.sim.entities.get(session.pid) as Entity;
    e.hp = 0;
    e.dead = true;
    e.pvpResurrect = true;
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
    const self = lastSelf(fc.sent);
    expect(self?.pvr).toBe(1);
    const client = bareClient(session.pid);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(
      JSON.parse(fc.sent[fc.sent.length - 1]),
    );
    expect(client.player.pvpResurrect).toBe(true);

    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'pvp_resurrect' }));
    expect(e.dead).toBe(false);
    expect(e.hp).toBe(e.maxHp);
    server.sim.tickCount++;
    (server as unknown as { broadcastSnapshots(): void }).broadcastSnapshots();
    expect(lastSelf(fc.sent)?.pvr).toBe(0);
  });
});

describe('updateDeathPromptView', () => {
  const at = { x: 0, z: 0 };
  it('shows the PvP Resurrect button only on a fresh corpse that carries the offer', () => {
    const v = createDeathPromptView();
    updateDeathPromptView(v, true, false, false, false, at, null, true);
    expect(v).toEqual({
      spiritMode: false,
      overlay: true,
      pvpResurrect: true,
      ghostHint: false,
      ghostPrompt: false,
      ghostRecap: false,
    });
    updateDeathPromptView(v, true, false, false, false, at, null, false);
    expect(v.overlay).toBe(true);
    expect(v.pvpResurrect).toBe(false);
    // An arena corpse gets no overlay at all, so no button either.
    updateDeathPromptView(v, true, false, true, false, at, null, true);
    expect(v.overlay).toBe(false);
    expect(v.pvpResurrect).toBe(false);
  });

  it('a ghost gets the spirit world and the corpse prompt in reach, never the button', () => {
    const v = createDeathPromptView();
    const same = updateDeathPromptView(v, true, true, false, false, at, { x: 30, z: 0 }, true);
    expect(same, 'the view is reused, never reallocated').toBe(v);
    expect(v).toEqual({
      spiritMode: true,
      overlay: false,
      pvpResurrect: false,
      ghostHint: true,
      ghostPrompt: true,
      ghostRecap: true,
    });
    updateDeathPromptView(v, true, true, false, false, at, { x: 40, z: 0 }, false);
    expect(v.ghostPrompt, 'out of corpse reach').toBe(false);
    updateDeathPromptView(v, true, true, false, true, at, { x: 1, z: 0 }, false);
    expect(v.ghostHint, 'a battleground ghost waits for the wave').toBe(false);
    expect(v.ghostPrompt).toBe(false);
    updateDeathPromptView(v, false, false, false, false, at, null, false);
    expect(Object.values(v).every((shown) => shown === false)).toBe(true);
  });
});

describe('the death panel fits three buttons', () => {
  it('wraps the actions row so PvP Resurrect never pushes Release or Recap past the panel', () => {
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const start = css.indexOf('#death-overlay .death-actions {');
    expect(start, 'the death actions rule').toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf('}', start));
    expect(rule).toContain('flex-wrap: wrap');
  });
});
