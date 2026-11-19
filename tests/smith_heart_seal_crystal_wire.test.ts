import { describe, expect, it, vi } from 'vitest';

// The heart seal crystal (src/sim/encounters/smith_heart/seal_crystal.ts) over
// the wire: no wire change, no IWorld change. The crystal is an ordinary
// object entity (its template id, its name, and a `loot` flag the sim holds
// false: there is no press); the seal markers carry the charge and the burst
// in their template ids; the burst is the server's own tick, the first one a
// living raider stands on the dais once the crystal is charged; and the online
// client's wall follows the mirrored entity (net/combat_wall_wire.ts), so it
// leaves with the entity the snapshot after the burst. This drives the REAL
// server snapshot path into the real online mirror (ClientWorld) and checks
// each. The collision view is one process-wide table the in-process server ALSO
// writes, so the client's wall is read only after the shared table is cleared
// and the client alone publishes. Db is mocked so no Postgres runs (mirrors
// smith_heart_council_soul_wire.test.ts).
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => null),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { GameServer } from '../server/game';
import { syncClientCombatWalls } from '../src/net/combat_wall_wire';
import {
  SMITH_HEART_DUNGEON,
  SMITH_HEART_SEAL_CRYSTAL_TEMPLATE,
} from '../src/sim/content/smith_heart';
import { SEAL_CRYSTAL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import {
  SEAL_CRYSTAL_TRIGGER_R,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_PORTAL_OPEN_LOG,
  SMITH_HEART_READY_BIT,
  SMITH_HEART_SEAL_FULL,
  sealCrystalOf,
  smithHeartSealMaskOf,
} from '../src/sim/encounters/smith_heart';
import { clearCombatWallStateForTest, combatWallsAt } from '../src/sim/instances/combat_wall_state';
import type { Entity } from '../src/sim/types';
import { bareClient, broadcast, fakeWs, joinServer } from './helpers/bare_client';

// biome-ignore lint/suspicious/noExplicitAny: the in-process server idiom (afk_wire.test.ts)
type Any = any;

describe('the heart seal crystal over the wire', () => {
  it('reaches the online mirror, bursts on the server tick a raider steps onto the dais, and its wall follows the entity', () => {
    const saved = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    let server: GameServer;
    try {
      server = new GameServer();
    } finally {
      if (saved === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = saved;
    }
    const sim = server.sim;
    const fc = fakeWs();
    const session = joinServer(server, fc, 1, 'Heartwalker');
    const pid = session.pid;
    sim.chat('/dev heart enter', pid);
    sim.chat('/dev heart tp portal', pid);
    const inst = sim.ctx.instances.find(
      (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
    );
    if (!inst) throw new Error('no claim');
    const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);

    // Everything but the snapshots lands here (events, command outcomes).
    const others: Any[] = [];
    const client: Any = bareClient(pid);
    const run = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        // The server loop's own pair: the tick's events routed to their sessions, then the snapshots.
        (server as Any).routeEvents(sim.tick());
        broadcast(server);
        for (const m of fc.sent.splice(0)) {
          if (m.t === 'snap') client.applySnapshot(m);
          else others.push(m);
        }
        syncClientCombatWalls(client);
      }
    };
    const press = (id: number, rid: number) => {
      server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'pickup', id, rid }));
    };
    const mirroredCrystal = () =>
      [...client.entities.values()].find(
        (e: Entity) => e.kind === 'object' && e.templateId === SMITH_HEART_SEAL_CRYSTAL_TEMPLATE,
      ) as Entity | undefined;
    const mirroredMarkers = () =>
      [...client.entities.values()]
        .filter((e: Entity) => e.kind === 'object' && smithHeartSealMaskOf(e.templateId) !== null)
        .map((e: Entity) => smithHeartSealMaskOf(e.templateId) as number);
    // The wall the CLIENT builds from its mirror: the table is shared with the
    // in-process server, so clear it and let only the client publish.
    const clientWall = () => {
      clearCombatWallStateForTest();
      syncClientCombatWalls(client);
      return combatWallsAt(o.x, o.z).find(
        (w) =>
          w.type === 'circle' &&
          Math.abs(w.x - SEAL_CRYSTAL.x) < 1e-6 &&
          Math.abs(w.z - SEAL_CRYSTAL.z) < 1e-6 &&
          Math.abs(w.r - SEAL_CRYSTAL.r) < 1e-9,
      );
    };
    const outcomes = (rid: number) =>
      others.filter((m) => m.t === 'commandOutcome' && m.rid === rid);
    const eventTexts = (type: string) =>
      others.flatMap((m) =>
        m.t === 'events' ? m.list.filter((e: Any) => e.type === type).map((e: Any) => e.text) : [],
      );

    run(20);
    const server0 = sealCrystalOf(sim.ctx, inst) as Entity;
    expect(server0).not.toBeNull();

    // Dark: the entity is mirrored as an ordinary object, not lootable, and its wall stands.
    const dark = mirroredCrystal();
    expect(dark).toBeDefined();
    expect(dark?.id).toBe(server0.id);
    expect(dark?.name).toBe('The Heart Seal Crystal');
    expect(dark?.lootable).toBe(false);
    expect(mirroredMarkers().length).toBeGreaterThan(0);
    expect(mirroredMarkers().every((m) => m === 0)).toBe(true);
    expect(clientWall()).toBeDefined();

    // At the Grand Stair's foot, a few steps short of the dais (the markers in
    // range are the ones mirrored so far): four veins lit and the Ring clear
    // charge the markers, and the crystal stays as it was (no press to offer).
    const offDais = SEAL_CRYSTAL_TRIGGER_R + 6;
    displacePlayerForDev(sim.ctx, sim.entities.get(pid) as Entity, o.x, o.z - offDais);
    sim.chat('/dev heart kill guardians', pid);
    // The Ring's four packs too (the team's doc of 2026-11-17).
    sim.chat('/dev heart kill trash', pid);
    run(3);
    expect(
      mirroredMarkers().every((m) => m === (SMITH_HEART_SEAL_FULL | SMITH_HEART_READY_BIT)),
    ).toBe(true);
    expect(mirroredCrystal()?.lootable).toBe(false);
    expect(clientWall()).toBeDefined();
    expect(eventTexts('log')).not.toContain(SMITH_HEART_PORTAL_OPEN_LOG);

    // The old press is gone over the wire too: a pickup on the charged crystal is refused.
    press(server0.id, 12);
    run(2);
    expect(outcomes(12)).toEqual([{ t: 'commandOutcome', rid: 12, ok: false }]);
    expect(mirroredCrystal()?.id).toBe(server0.id);

    // Down onto the dais, beside the wall: the server's tick bursts it.
    displacePlayerForDev(sim.ctx, sim.entities.get(pid) as Entity, o.x, o.z - (SEAL_CRYSTAL.r + 2));
    run(3);
    expect(eventTexts('log').filter((t) => t === SMITH_HEART_PORTAL_OPEN_LOG)).toHaveLength(1);
    // The entity left the mirror, the markers carry the burst, the client's wall left with it.
    expect(mirroredCrystal()).toBeUndefined();
    expect(client.entities.has(server0.id)).toBe(false);
    expect(
      mirroredMarkers().every(
        (m) => m === (SMITH_HEART_SEAL_FULL | SMITH_HEART_READY_BIT | SMITH_HEART_PORTAL_BIT),
      ),
    ).toBe(true);
    expect(clientWall()).toBeUndefined();

    // Nothing is left to burst: the line never comes again.
    run(10);
    expect(eventTexts('log').filter((t) => t === SMITH_HEART_PORTAL_OPEN_LOG)).toHaveLength(1);
    clearCombatWallStateForTest();
  });
});
